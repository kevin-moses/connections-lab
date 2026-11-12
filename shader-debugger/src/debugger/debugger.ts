import type { Program } from '@shaderfrog/glsl-parser/ast';
import type { ShaderRunner } from '../render/runner';
import type { CanonicalUniforms } from '../render/gl';
import type { ShaderEditor } from '../editor/editor';
import { traceCall, traceFragment, type TraceResult, type TraceStep, type VarSnap } from '../interp/interpreter';
import { crossCheck, type CrossCheck } from '../interp/crossCheck';
import { formatNumber, formatValue, isArrayValue, valueTypeName, type AnyValue } from '../interp/values';
import {
  alignStep,
  divergentLines,
  inlineValues,
  inlineValuesAligned,
  runToLine,
  stepBackOver,
  stepOut,
  stepOver,
} from './navigation';

export interface DebuggerUI {
  bottom: HTMLElement;
  tabDebug: HTMLButtonElement;
  tabProblems: HTMLButtonElement;
  panelDebug: HTMLElement;
  panelProblems: HTMLElement;
  empty: HTMLElement;
  main: HTMLElement;
  pixels: HTMLElement;
  check: HTMLElement;
  refresh: HTMLButtonElement;
  close: HTMLButtonElement;
  nav: HTMLElement;
  slider: HTMLInputElement;
  count: HTMLElement;
  now: HTMLElement;
  vars: HTMLTableElement;
  stack: HTMLElement;
  markerA: HTMLElement;
  markerB: HTMLElement;
  canvas: HTMLCanvasElement;
  canvasWrap: HTMLElement;
}

/** One traced run: a pixel, or a single function call from a test. */
interface PixelRun {
  pixel: [number, number] | null;
  call: string | null;
  trace: TraceResult;
  /** GPU comparison; null for function calls (no pixel to compare). */
  check: CrossCheck | null;
}

const CLICK_SLOP_PX = 4;

/**
 * Single-pixel stepper: click a pixel, the shader runs on the CPU for just
 * that pixel, and you scrub through every step. Shift-click a second pixel
 * to compare the two side by side.
 */
export class Debugger {
  private ast: Program | null = null;
  private compiled = false;
  private a: PixelRun | null = null;
  private b: PixelRun | null = null;
  private frozen: CanonicalUniforms | null = null;
  private cur = 0;
  private downAt: [number, number] | null = null;

  constructor(
    private readonly runner: ShaderRunner,
    private readonly editor: ShaderEditor,
    private readonly ui: DebuggerUI,
  ) {
    // Click (not drag) on the canvas picks a pixel.
    ui.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.downAt = [e.clientX, e.clientY];
    });
    ui.canvas.addEventListener('pointerup', (e) => {
      const start = this.downAt;
      this.downAt = null;
      if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > CLICK_SLOP_PX) return;
      const [x, y] = runner.toCanvasPixels(e);
      this.pick([Math.floor(x), Math.floor(y)], e.shiftKey && this.a ? 'b' : 'a');
    });

    ui.tabDebug.addEventListener('click', () => this.showTab('debug'));
    ui.tabProblems.addEventListener('click', () => this.showTab('problems'));
    ui.close.addEventListener('click', () => this.close());
    ui.refresh.addEventListener('click', () => {
      this.frozen = runner.currentUniforms();
      this.retrace();
    });
    ui.slider.addEventListener('input', () => this.go(Number(ui.slider.value)));
    ui.nav.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-nav]');
      if (btn) this.navigate(btn.dataset.nav!);
    });
    ui.panelDebug.addEventListener('keydown', (e) => this.onKey(e));
    new ResizeObserver(() => this.placeMarkers()).observe(ui.canvas);
  }

  get active(): boolean {
    return this.a !== null;
  }

  /** New source: re-run the picked pixels so values follow your edits. */
  setSource(ast: Program | null, compiled: boolean): void {
    this.ast = ast;
    this.compiled = compiled;
    if (this.a && ast && compiled) this.retrace();
  }

  showTab(tab: 'debug' | 'problems'): void {
    const debug = tab === 'debug';
    this.ui.tabDebug.setAttribute('aria-selected', String(debug));
    this.ui.tabProblems.setAttribute('aria-selected', String(!debug));
    this.ui.panelDebug.hidden = !debug;
    this.ui.panelProblems.hidden = debug;
  }

  close(): void {
    this.a = null;
    this.b = null;
    this.frozen = null;
    this.editor.showDebug(null);
    this.render();
  }

  /** Step through one pixel with the given uniforms (e.g. a lesson prediction). */
  stepPixel(pixel: [number, number], uniforms: CanonicalUniforms): void {
    if (!this.ast || !this.compiled) return;
    this.frozen = uniforms;
    this.a = this.run(pixel);
    this.b = null;
    this.cur = 0;
    this.open();
  }

  /** Step through a single call, e.g. a failing function test. */
  stepCall(call: string): void {
    if (!this.ast) return;
    this.frozen = this.runner.currentUniforms();
    this.a = this.runCall(call);
    this.b = null;
    this.cur = 0;
    this.open();
  }

  private open(): void {
    this.showTab('debug');
    this.ui.panelDebug.focus({ preventScroll: true });
    this.render();
  }

  private pick(pixel: [number, number], which: 'a' | 'b'): void {
    if (!this.ast || !this.compiled) return;
    if (which === 'b' && !this.a?.pixel) which = 'a';
    if (which === 'a' || !this.frozen) this.frozen = this.runner.currentUniforms();
    const run = this.run(pixel);
    if (which === 'a') {
      this.a = run;
      this.b = null;
      this.cur = 0;
    } else {
      this.b = run;
    }
    this.showTab('debug');
    this.ui.panelDebug.focus({ preventScroll: true });
    this.render();
  }

  private run(pixel: [number, number]): PixelRun {
    const u = this.frozen!;
    const trace = traceFragment(this.ast!, {
      pixel,
      uniforms: { u_resolution: u.resolution, u_time: u.time, u_mouse: u.mouse },
    });
    const gpu = this.runner.readOutputAt(pixel[0], pixel[1], u);
    return { pixel, call: null, trace, check: crossCheck(trace, gpu) };
  }

  private runCall(call: string): PixelRun {
    const u = this.frozen!;
    const trace = traceCall(this.ast!, call, {
      pixel: [0, 0],
      uniforms: { u_resolution: u.resolution, u_time: u.time, u_mouse: u.mouse },
    });
    return { pixel: null, call, trace, check: null };
  }

  private rerun(r: PixelRun): PixelRun {
    return r.call !== null ? this.runCall(r.call) : this.run(r.pixel!);
  }

  private retrace(): void {
    if (!this.a || !this.ast) return;
    const old = this.a.trace.steps;
    this.a = this.rerun(this.a);
    if (this.b) this.b = this.rerun(this.b);
    const steps = this.a.trace.steps;
    // Stay on the same line occurrence if it still exists.
    const aligned = old.length ? alignStep(old, Math.min(this.cur, old.length - 1), steps) : null;
    this.cur = Math.min(aligned ?? this.cur, Math.max(0, steps.length - 1));
    this.render();
  }

  private navigate(action: string): void {
    const steps = this.a?.trace.steps;
    if (!steps?.length) return;
    const last = steps.length - 1;
    const target: Record<string, () => number | null> = {
      start: () => 0,
      end: () => last,
      back: () => Math.max(0, this.cur - 1),
      step: () => Math.min(last, this.cur + 1),
      over: () => stepOver(steps, this.cur),
      backOver: () => stepBackOver(steps, this.cur),
      out: () => stepOut(steps, this.cur),
      cursor: () => runToLine(steps, this.cur, this.editor.cursorLine()),
    };
    const next = target[action]?.();
    if (next === null || next === undefined) {
      if (action === 'cursor') this.flashNow(`Line ${this.editor.cursorLine()} never runs for this pixel.`);
      return;
    }
    this.go(next);
  }

  private onKey(e: KeyboardEvent): void {
    const map: Record<string, string> = e.shiftKey
      ? { ArrowRight: 'over', ArrowLeft: 'backOver' }
      : { ArrowRight: 'step', ArrowLeft: 'back', Home: 'start', End: 'end', Escape: '' };
    if (!(e.key in map)) return;
    e.preventDefault();
    if (e.key === 'Escape') this.close();
    else this.navigate(map[e.key]);
  }

  private go(i: number): void {
    this.cur = i;
    this.render();
    const step = this.a?.trace.steps[i];
    if (step) this.editor.revealLine(step.line);
  }

  // ---------- rendering ----------

  private render(): void {
    const ui = this.ui;
    const a = this.a;
    ui.empty.hidden = !!a;
    ui.main.hidden = !a;
    this.placeMarkers();
    if (!a) return;

    const steps = a.trace.steps;
    const step = steps[this.cur] as TraceStep | undefined;
    ui.slider.max = String(Math.max(0, steps.length - 1));
    ui.slider.value = String(this.cur);
    ui.count.textContent = steps.length ? `${this.cur + 1} / ${steps.length}` : '0 / 0';

    this.renderPixels();
    this.renderCheck();
    this.renderNow(step);
    this.renderVars(step);
    this.renderStack(step);
    this.renderEditor();
  }

  private renderPixels(): void {
    const chip = (which: 'a' | 'b', run: PixelRun) => {
      const span = document.createElement('span');
      span.className = `pixel-chip ${which}`;
      span.innerHTML = run.pixel
        ? `<span class="dot"></span>${which.toUpperCase()} (${run.pixel[0]}, ${run.pixel[1]})`
        : `<span class="dot"></span>test: <code>${esc(run.call ?? '')}</code>`;
      const x = document.createElement('button');
      x.textContent = '×';
      x.title = which === 'a' ? 'Stop debugging' : 'Stop comparing';
      x.addEventListener('click', () => (which === 'a' ? this.close() : ((this.b = null), this.render())));
      span.append(x);
      return span;
    };
    const parts: HTMLElement[] = [chip('a', this.a!)];
    if (this.b) parts.push(chip('b', this.b));
    const meta = document.createElement('span');
    meta.className = 'pixel-meta';
    const u = this.frozen!;
    meta.textContent = this.a!.pixel ? `t = ${u.time.toFixed(2)}s${this.b ? '' : ' · shift-click to compare'}` : 'runs your function on the CPU';
    parts.push(meta);
    this.ui.pixels.replaceChildren(...parts);
  }

  private renderCheck(): void {
    const checks = [this.a!.check, this.b?.check].filter((c): c is CrossCheck => !!c);
    const el0 = this.ui.check;
    if (!checks.length) {
      el0.textContent = 'CPU only';
      el0.className = 'pill';
      el0.title = 'A function test has no pixel, so there is nothing to compare with the GPU.';
      return;
    }
    const worst = checks.find((c) => c.status === 'mismatch') ?? checks.find((c) => c.status === 'unavailable') ?? checks[0];
    const el = this.ui.check;
    const label = { match: 'GPU ✓ agrees', mismatch: 'GPU ≠ stepper', unavailable: 'GPU –' }[worst.status];
    el.textContent = label;
    el.className = `pill ${worst.status === 'match' ? 'ok' : worst.status === 'mismatch' ? 'error' : ''}`;
    const fmt = (v: number[] | null) => (v ? `(${v.map((x) => formatNumber(x)).join(', ')})` : '—');
    el.title = checks.map((c, i) => `${i ? 'B' : 'A'}: ${c.message}\nstepper ${fmt(c.cpu)}\nGPU     ${fmt(c.gpu)}`).join('\n\n');
  }

  private renderNow(step: TraceStep | undefined): void {
    const el = this.ui.now;
    const t = this.a!.trace;
    const rows: string[] = [];
    if (step) {
      const pass = step.loopIter ? ` · loop pass ${step.loopIter}` : '';
      rows.push(`<div class="where">line ${step.line} · in ${esc(step.fn)}()${pass}</div>`);
      rows.push(`<div><span class="kind">${step.kind}</span>${esc(step.text || '(no change)')}</div>`);
      if (this.b) {
        const j = alignStep(t.steps, this.cur, this.b.trace.steps);
        const bt = j === null ? 'B never reaches this step' : this.b.trace.steps[j].text || '(no change)';
        rows.push(`<div class="b-text">B: ${esc(bt)}</div>`);
      }
      for (const c of step.builtins) {
        rows.push(`<div class="builtin">${esc(c.name)}(${esc(c.args.join(', '))}) <span class="arrow">→</span> ${esc(c.result)}</div>`);
      }
    }
    const isLast = this.cur === t.steps.length - 1;
    if (t.error && isLast) rows.push(`<div class="error">Stopped: ${esc(t.error.message)}${t.error.line ? ` (line ${t.error.line})` : ''}</div>`);
    el.innerHTML = rows.join('');
  }

  private renderVars(step: TraceStep | undefined): void {
    const table = this.ui.vars;
    if (!step) {
      table.innerHTML = '';
      return;
    }
    const bStep = this.b ? this.b.trace.steps[alignStep(this.a!.trace.steps, this.cur, this.b.trace.steps) ?? -1] : undefined;
    const lookupB = (name: string, group: 'locals' | 'globals' | 'inputs'): AnyValue | null => {
      if (!this.b) return null;
      if (group === 'inputs') return this.b.trace.inputs.find((v) => v.name === name)?.value ?? null;
      return bStep?.[group].find((v) => v.name === name)?.value ?? null;
    };
    const changed = new Set(step.changed);
    const compare = !!this.b;

    const head = `<thead><tr><th>name</th><th>type</th><th>${compare ? 'A' : 'value'}</th>${compare ? '<th>B</th>' : ''}</tr></thead>`;
    const rows: string[] = [];
    const group = (title: string, vars: VarSnap[], kind: 'locals' | 'globals' | 'inputs') => {
      if (!vars.length) return;
      rows.push(`<tr class="group"><td colspan="${compare ? 4 : 3}">${esc(title)}</td></tr>`);
      for (const v of vars) {
        const bv = lookupB(v.name, kind);
        const differs = compare && bv !== null && formatValue(bv) !== formatValue(v.value);
        const cls = [kind !== 'inputs' && changed.has(v.name) ? 'changed' : '', differs ? 'differs' : ''].join(' ');
        rows.push(
          `<tr class="${cls}"><td class="name">${esc(v.name)}</td><td class="type">${esc(valueTypeName(v.value))}</td>` +
            `<td class="val">${valueHtml(v.value)}</td>` +
            (compare ? `<td class="val b">${bv ? valueHtml(bv) : '—'}</td>` : '') +
            '</tr>',
        );
      }
    };
    group(`${step.fn}() locals`, step.locals, 'locals');
    group('outputs & globals', step.globals, 'globals');
    group('inputs', this.a!.trace.inputs, 'inputs');
    table.innerHTML = head + `<tbody>${rows.join('')}</tbody>`;
  }

  private renderStack(step: TraceStep | undefined): void {
    const list = this.ui.stack;
    list.replaceChildren();
    if (!step) return;
    for (const frame of [...step.stack].reverse()) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${esc(frame.fn)}()</span><span class="ln">ln ${frame.line}</span>`;
      li.addEventListener('click', () => this.editor.revealLine(frame.line));
      list.append(li);
    }
  }

  private renderEditor(): void {
    const a = this.a!.trace.steps;
    const step = a[this.cur];
    const bInline = this.b ? inlineValuesAligned(a, this.cur, this.b.trace.steps) : null;
    this.editor.showDebug({
      execLine: step?.line ?? null,
      inline: inlineValues(a, this.cur).map((v) => ({
        line: v.line,
        text: v.text,
        textB: bInline ? bInline.get(v.line) ?? '' : null,
        current: v.step === this.cur,
      })),
      diverge: this.b ? divergentLines(a, this.b.trace.steps) : [],
    });
  }

  private placeMarkers(): void {
    const place = (el: HTMLElement, run: PixelRun | null) => {
      if (!run?.pixel || !this.frozen) {
        el.hidden = true;
        return;
      }
      const wrap = this.ui.canvasWrap.getBoundingClientRect();
      const rect = this.ui.canvas.getBoundingClientRect();
      const [rw, rh] = this.frozen.resolution;
      el.style.left = `${rect.left - wrap.left + ((run.pixel[0] + 0.5) / rw) * rect.width}px`;
      el.style.top = `${rect.top - wrap.top + (1 - (run.pixel[1] + 0.5) / rh) * rect.height}px`;
      el.hidden = false;
    };
    place(this.ui.markerA, this.a);
    place(this.ui.markerB, this.b);
  }

  private flashNow(message: string): void {
    const div = document.createElement('div');
    div.className = 'error';
    div.textContent = message;
    this.ui.now.append(div);
    setTimeout(() => div.remove(), 2500);
  }
}

/** Value with a color chip for float vec3/vec4 (they're usually colors). */
function valueHtml(v: AnyValue): string {
  const text = esc(formatValue(v));
  if (isArrayValue(v) || v.type.base !== 'float' || v.type.cols !== 1 || v.type.rows < 3) return text;
  const c = v.data.slice(0, 3).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255));
  return `<span class="swatch-chip" style="background: rgb(${c.join(',')})"></span>${text}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
