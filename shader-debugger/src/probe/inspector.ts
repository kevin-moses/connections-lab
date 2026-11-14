import type { Program } from '@shaderfrog/glsl-parser/ast';
import type { ShaderRunner } from '../render/runner';
import type { ShaderEditor } from '../editor/editor';
import { resolveProbeTarget, type ProbeTarget } from './target';
import { buildProbeShader, KIND_NAMES } from './rewrite';
import { ProbeLayer, type Channel, type PixelSample, type ProbeStats, type VizMode } from './probeLayer';

export interface InspectorUI {
  toggle: HTMLButtonElement;
  bar: HTMLElement;
  expr: HTMLElement;
  type: HTMLElement;
  where: HTMLElement;
  modeSeg: HTMLElement;
  channelSeg: HTMLElement;
  iterWrap: HTMLElement;
  iter: HTMLSelectElement;
  legend: HTMLElement;
  message: HTMLElement;
  readout: HTMLElement;
  canvas: HTMLCanvasElement;
  canvasWrap: HTMLElement;
}

const MAX_ITER_OPTIONS = 64;

/**
 * Value-as-image controller: the value under the editor cursor, captured
 * after its statement runs, shown for every pixel at once.
 */
export class Inspector {
  private enabled = false;
  private source = '';
  private ast: Program | null = null;
  private target: ProbeTarget | null = null;
  private compiledCode: string | null = null;
  private hover: [number, number] | null = null;
  private stats: ProbeStats | null = null;
  private iterOptionsFor = -1;
  private readonly layer: ProbeLayer;

  /** Throws if the GPU can't render float textures (value-as-image needs them). */
  constructor(
    private readonly runner: ShaderRunner,
    private readonly editor: ShaderEditor,
    private readonly ui: InspectorUI,
  ) {
    this.layer = new ProbeLayer(runner.pass);
    runner.overlay = this.layer;
    ui.toggle.addEventListener('click', () => this.setEnabled(!this.enabled));

    ui.modeSeg.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
      if (!btn) return;
      this.layer.setView({ mode: btn.dataset.mode as VizMode });
      this.syncControls();
    });
    ui.channelSeg.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-channel]');
      if (!btn || btn.disabled) return;
      this.layer.setView({ channel: Number(btn.dataset.channel) as Channel });
      this.syncControls();
    });
    const pickIteration = () => this.layer.setView({ iteration: Number(ui.iter.value) });
    ui.iter.addEventListener('change', pickIteration);
    ui.iter.addEventListener('input', pickIteration);

    ui.canvas.addEventListener('pointermove', (e) => {
      this.hover = this.runner.toCanvasPixels(e);
      this.positionReadout(e);
    });
    ui.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      ui.readout.hidden = true;
    });

    this.layer.statsChanged.on((s) => this.onStats(s));
    runner.frame.on(() => this.updateReadout());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.ui.toggle.setAttribute('aria-pressed', String(on));
    this.ui.bar.hidden = !on;
    this.runner.mouseMode = on ? 'drag' : 'hover';
    if (on) {
      this.update();
    } else {
      this.target = null;
      this.compiledCode = null;
      this.layer.setProgram(null);
      this.editor.showProbe(null);
      this.ui.readout.hidden = true;
    }
  }

  /** New source was parsed (ast is null if it didn't parse). */
  setSource(source: string, ast: Program | null): void {
    this.source = source;
    this.ast = ast;
    if (this.enabled) this.update();
  }

  onCursor(): void {
    if (this.enabled) this.update();
  }

  private update(): void {
    if (!this.ast) {
      this.say('Fix the errors to update the inspector.');
      return;
    }
    const target = resolveProbeTarget(this.ast, this.source, this.editor.getCursor());
    if (!target) {
      // Keep the current probe while the cursor rests on a blank line, a
      // loop header, a global, etc.
      if (!this.target) this.say('Put the cursor on a statement inside a function.', 'info');
      return;
    }

    const built = buildProbeShader(this.ast, this.source, target);
    if (!built.ok) {
      this.say(built.reason);
      return;
    }
    if (built.code === this.compiledCode) return; // nothing changed

    const result = this.runner.buildProgram(built.code);
    if (!result.ok) {
      const first = result.diagnostics[0]?.message ?? 'unknown error';
      this.say(`Can't show ${target.label} as an image: ${first}`);
      return;
    }
    this.layer.setProgram(result.program);

    const changedTarget = this.target?.expr !== target.expr || this.target?.line !== target.line;
    this.target = target;
    this.compiledCode = built.code;
    if (changedTarget) {
      this.layer.setView({ iteration: 0, channel: -1 });
      this.iterOptionsFor = -1;
    }
    this.editor.showProbe({ line: target.line, exprRange: target.exprRange });
    this.ui.expr.textContent = target.label;
    this.ui.where.textContent = `after line ${target.line}${target.functionName !== 'main' ? ` · in ${target.functionName}()` : ''}`;
    this.say('');
    this.syncControls();
  }

  private onStats(s: ProbeStats): void {
    this.stats = s;
    this.ui.type.textContent = s.reached ? typeName(s.dim, s.kind) : '';
    if (!s.reached) {
      this.say(s.maxHits > 0 ? 'No pixel ran the loop that many times.' : 'No pixel reaches this line.', 'info');
    } else if (this.ui.message.classList.contains('info')) {
      this.say('');
    }
    this.syncIterations(s.maxHits);
    this.syncControls();
  }

  /** Loop-pass picker appears when some pixel hits the probe more than once. */
  private syncIterations(maxHits: number): void {
    const n = Math.min(Math.round(maxHits), MAX_ITER_OPTIONS);
    this.ui.iterWrap.hidden = n <= 1;
    if (n === this.iterOptionsFor) return;
    this.iterOptionsFor = n;
    const current = this.layer.view.iteration;
    const options = [`<option value="0">last</option>`];
    for (let i = 1; i <= n; i++) options.push(`<option value="${i}">${i}</option>`);
    this.ui.iter.innerHTML = options.join('');
    this.ui.iter.value = String(current <= n ? current : 0);
  }

  private syncControls(): void {
    const view = this.layer.view;
    const dim = this.stats?.dim || 4;
    for (const b of this.ui.modeSeg.querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('active', b.dataset.mode === view.mode);
    }
    for (const b of this.ui.channelSeg.querySelectorAll<HTMLButtonElement>('button')) {
      const ch = Number(b.dataset.channel);
      b.disabled = ch >= dim;
      b.classList.toggle('active', ch === view.channel);
    }
    this.ui.channelSeg.hidden = dim <= 1;
    this.renderLegend();
  }

  private renderLegend(): void {
    const view = this.layer.view;
    const s = this.stats;
    const unreached = `<span class="legend-item"><span class="swatch unreached"></span>not reached</span>`;
    let html = '';
    if (view.mode === 'raw') {
      html = `<span class="legend-item"><span class="swatch under"></span>below 0</span>
        <span class="legend-item"><span class="swatch over"></span>above 1</span>${unreached}`;
    } else if (view.mode === 'diverging') {
      const m = s?.absMax ?? 1;
      const note = (s?.dim ?? 1) > 1 && view.channel === -1 ? `<span class="legend-item">showing .x, pick a component</span>` : '';
      html = `<span class="legend-item"><span class="ramp-label">${fmt(-m)}</span><span class="ramp diverging"></span><span class="ramp-label">${fmt(m)}</span></span>${note}${unreached}`;
    } else {
      html = `<span class="legend-item"><span class="ramp-label">${fmt(s?.min ?? 0)}</span><span class="ramp auto"></span><span class="ramp-label">${fmt(s?.max ?? 1)}</span></span>${unreached}`;
    }
    this.ui.legend.innerHTML = html;
  }

  private updateReadout(): void {
    const tip = this.ui.readout;
    if (!this.enabled || !this.hover || !this.target || !this.layer.active) {
      tip.hidden = true;
      return;
    }
    const sample = this.layer.sample(this.hover[0], this.hover[1]);
    if (!sample) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = readoutHtml(this.target.label, sample, this.layer.view.iteration);
    tip.hidden = false;
  }

  private positionReadout(e: PointerEvent): void {
    const wrap = this.ui.canvasWrap.getBoundingClientRect();
    const tip = this.ui.readout;
    const x = e.clientX - wrap.left;
    const y = e.clientY - wrap.top;
    const w = tip.offsetWidth || 220;
    const h = tip.offsetHeight || 48;
    const left = x + 16 + w > wrap.width ? x - 16 - w : x + 16;
    const top = y + 16 + h > wrap.height ? y - 16 - h : y + 16;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  }

  private say(text: string, kind: 'warn' | 'info' = 'warn'): void {
    this.ui.message.textContent = text;
    this.ui.message.classList.toggle('info', kind === 'info');
  }
}

export function typeName(dim: number, kind: number): string {
  const base = KIND_NAMES[kind] ?? 'float';
  if (dim <= 1) return base;
  const prefix = { float: '', int: 'i', uint: 'u', bool: 'b' }[base];
  return `${prefix}vec${dim}`;
}

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
  return Number(v.toFixed(4)).toString();
}

function readoutHtml(label: string, s: PixelSample, iteration: number): string {
  const where = `<div class="meta">pixel ${s.x}, ${s.y}</div>`;
  if (!s.written) return `<div><span class="name">${esc(label)}</span> · discarded</div>${where}`;
  if (s.hits === 0) return `<div><span class="name">${esc(label)}</span> · line not reached here</div>${where}`;
  if (s.capturedAt === 0) {
    return `<div><span class="name">${esc(label)}</span> · loop ran only ${s.hits}×, pass ${iteration} never happened</div>${where}`;
  }

  const kind = KIND_NAMES[s.kind] ?? 'float';
  const parts = s.value.map((v) => {
    const text = kind === 'bool' ? String(v > 0.5) : kind === 'float' ? fmt(v) : String(Math.round(v));
    const oor = kind === 'float' && (v < 0 || v > 1);
    return oor ? `<span class="oor">${text}</span>` : text;
  });
  const value = parts.length === 1 ? parts[0] : `(${parts.join(', ')})`;
  const c = s.value.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
  const rgb = s.dim === 1 ? [c[0], c[0], c[0]] : [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  const chip = `<span class="chip" style="background: rgb(${rgb.join(',')})"></span>`;
  const loop = s.hits > 1 ? ` · pass ${s.capturedAt} of ${s.hits}` : '';
  return `<div>${chip}<span class="name">${esc(label)}</span> = <span class="val">${value}</span></div>
    <div class="meta">pixel ${s.x}, ${s.y} · ${typeName(s.dim, s.kind)}${loop}</div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
