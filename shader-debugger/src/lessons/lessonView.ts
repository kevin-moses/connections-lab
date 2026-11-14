import { marked } from 'marked';
import type { Program } from '@shaderfrog/glsl-parser/ast';
import type { ShaderRunner } from '../render/runner';
import type { Debugger } from '../debugger/debugger';
import { paintImage, type OffscreenRenderer } from '../render/offscreen';
import { checkExercise, type CheckItem, type CheckReport } from './checker';
import { answerFromLabel, revealPrediction, type Reveal } from './predict';
import { saveProgress, type Progress } from './progress';
import { DEFAULT_CANVAS, type Exercise, type Lesson } from './types';
import { convertStyle } from '../dialects/convert';
import { detectStyle } from '../glsl/prepare';
import type { CheckSummary, CodeContext, HintLevel } from '../../shared/tutor';
import { askTutor, tutorHtml, tutorInlineHtml } from '../tutor/client';

export interface LessonUI {
  pane: HTMLElement;
  select: HTMLSelectElement;
  dots: HTMLElement;
  scroll: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  reset: HTMLButtonElement;
}

export interface LessonDeps {
  lessons: Lesson[];
  progress: Progress;
  runner: ShaderRunner;
  debug: Debugger;
  renderer: OffscreenRenderer;
  ui: LessonUI;
  /** Put new code in the editor (and compile it). */
  loadCode(code: string): void;
  /** What every tutor request carries: code, cursor, exercise, errors. Hints add checks and the stepper. */
  tutorContext(): CodeContext;
}

const PREVIEW_WIDTH = 168;
const MAX_HINTS = 6;
const HINT_NAMES: Record<HintLevel, string> = { 1: 'Nudge', 2: 'Concept', 3: 'Steps' };
const CHECK_DEBOUNCE_MS = 150;

/**
 * The lesson pane: instructions, a predict-then-reveal question, the target
 * preview, and a live checklist that re-runs as you type.
 */
export class LessonController {
  private exercise: Exercise;
  private ast: Program | null = null;
  private source = '';
  private report: CheckReport | null = null;
  private checkTimer = 0;
  private previewCanvas: HTMLCanvasElement | null = null;
  private frameCount = 0;
  /** Exercises with a hint request in flight (one at a time each). */
  private readonly hintsPending = new Set<string>();
  /** Redraws the current exercise's hint card. */
  private redrawHints: ((error?: string) => void) | null = null;

  constructor(private readonly d: LessonDeps) {
    const all = d.lessons.flatMap((l) => l.exercises);
    this.exercise = all.find((e) => e.id === d.progress.current) ?? all[0];

    d.ui.select.addEventListener('change', () => {
      const lesson = d.lessons.find((l) => l.id === d.ui.select.value);
      if (lesson) this.open(this.firstUnfinished(lesson).id);
    });
    d.ui.prev.addEventListener('click', () => this.step(-1));
    d.ui.next.addEventListener('click', () => this.step(1));
    d.ui.reset.addEventListener('click', () => {
      if (!confirm('Replace your code for this exercise with the starter code?')) return;
      this.state.code = this.starter;
      saveProgress(d.progress);
      d.loadCode(this.starter);
    });
  }

  get current(): Exercise {
    return this.exercise;
  }

  get canvasSize(): [number, number] {
    return this.exercise.config.canvas ?? DEFAULT_CANVAS;
  }

  /** The learner's code for the current exercise. */
  get code(): string {
    return this.state.code ?? this.starter;
  }

  /** The starter, in the style the learner picked. */
  private get starter(): string {
    return convertStyle(this.exercise.starter, this.d.progress.style) ?? this.exercise.starter;
  }

  /** Latest checklist, for the tutor. */
  checkSummary(): CheckSummary[] | undefined {
    return this.report?.items.map((i) => ({ label: i.label, passed: i.passed, detail: i.detail }));
  }

  private get state() {
    const s = (this.d.progress.exercises[this.exercise.id] ??= {});
    return s;
  }

  open(id: string): void {
    const ex = this.d.lessons.flatMap((l) => l.exercises).find((e) => e.id === id);
    if (!ex) return;
    this.exercise = ex;
    this.report = null;
    this.d.progress.current = id;
    saveProgress(this.d.progress);
    this.d.debug.close();
    this.d.runner.setFixedSize(this.canvasSize);
    this.render();
    // Show saved code in the chosen style too (left alone if it doesn't parse).
    const code = this.code;
    if (this.state.code !== undefined && detectStyle(code) !== this.d.progress.style) {
      this.state.code = convertStyle(code, this.d.progress.style) ?? code;
      saveProgress(this.d.progress);
    }
    this.d.loadCode(this.code);
  }

  /** Called on every edit. */
  saveCode(source: string): void {
    this.state.code = source;
    saveProgress(this.d.progress);
  }

  /** Called after each compile with the parsed AST (null if it didn't parse). */
  onCompiled(source: string, ast: Program | null): void {
    this.source = source;
    this.ast = ast;
    clearTimeout(this.checkTimer);
    this.checkTimer = window.setTimeout(() => this.runChecks(), CHECK_DEBOUNCE_MS);
  }

  /** Called every frame: keep the target preview live (time, mouse). */
  onFrame(): void {
    if (!this.previewCanvas || this.d.ui.pane.hidden || this.frameCount++ % 2) return;
    const [w, h] = this.canvasSize;
    const pw = PREVIEW_WIDTH;
    const ph = Math.round((PREVIEW_WIDTH * h) / w);
    const u = this.d.runner.currentUniforms();
    const [rw, rh] = u.resolution;
    const r = this.d.renderer.render({
      source: this.exercise.reference,
      width: pw,
      height: ph,
      time: u.time,
      mouse: [(u.mouse[0] / rw) * pw, (u.mouse[1] / rh) * ph],
    });
    if (r.ok) paintImage(this.previewCanvas, r.image);
  }

  // ---------- navigation ----------

  private step(delta: number): void {
    const all = this.d.lessons.flatMap((l) => l.exercises);
    const i = all.findIndex((e) => e.id === this.exercise.id);
    const next = all[i + delta];
    if (next) this.open(next.id);
  }

  private firstUnfinished(lesson: Lesson): Exercise {
    return lesson.exercises.find((e) => !this.d.progress.exercises[e.id]?.passed) ?? lesson.exercises[0];
  }

  // ---------- checks ----------

  private runChecks(): void {
    const report = checkExercise(this.exercise, this.source, this.d.renderer.render);
    const wasPassed = !!this.state.passed;
    this.report = report;
    if (report.passed && !wasPassed) {
      this.state.passed = true;
      saveProgress(this.d.progress);
      this.renderHeader();
    }
    this.renderChecks(report.passed && !wasPassed);
  }

  // ---------- rendering ----------

  private render(): void {
    this.renderHeader();
    const ex = this.exercise;
    const lesson = this.d.lessons.find((l) => l.id === ex.lessonId)!;
    const scroll = this.d.ui.scroll;
    scroll.replaceChildren();

    if (ex.index === 0) {
      scroll.append(html(`<section class="lesson-intro"><h2>${esc(lesson.title)}</h2>${md(lesson.intro)}</section>`));
    } else {
      scroll.append(html(`<details class="lesson-intro collapsed"><summary>About this lesson</summary>${md(lesson.intro)}</details>`));
    }
    scroll.append(html(`<article class="prompt">${md(ex.prompt)}</article>`));

    if (ex.config.predict) scroll.append(this.predictCard());

    const target = html(`<section class="card target-card">
      <div class="card-title">Target <span class="muted">${ex.config.animated ? '· animated' : ''}${ex.config.variants?.some((v) => v.mouse) ? '· follows the mouse' : ''}</span></div>
      <canvas class="target-preview"></canvas>
    </section>`);
    this.previewCanvas = target.querySelector('canvas');
    scroll.append(target);

    scroll.append(html(`<section class="card checks-card"><div class="card-title">Checks <span class="muted checks-summary"></span></div><div class="checks-banner" hidden></div><ul class="checks"></ul></section>`));
    scroll.append(this.tutorCard());
    scroll.scrollTop = 0;
    this.frameCount = 0;
    this.onFrame();
  }

  private renderHeader(): void {
    const { ui, lessons, progress } = this.d;
    const ex = this.exercise;
    ui.select.replaceChildren(
      ...lessons.map((l) => {
        const done = l.exercises.filter((e) => progress.exercises[e.id]?.passed).length;
        const opt = new Option(`${l.index + 1}. ${l.title}  (${done}/${l.exercises.length})`, l.id);
        opt.selected = l.id === ex.lessonId;
        return opt;
      }),
    );
    const lesson = lessons.find((l) => l.id === ex.lessonId)!;
    ui.dots.replaceChildren(
      ...lesson.exercises.map((e) => {
        const b = document.createElement('button');
        b.className = `ex-dot${e.id === ex.id ? ' current' : ''}${progress.exercises[e.id]?.passed ? ' done' : ''}`;
        b.textContent = progress.exercises[e.id]?.passed ? '✓' : String(e.index + 1);
        b.title = `${e.index + 1}. ${e.config.title}`;
        b.addEventListener('click', () => this.open(e.id));
        return b;
      }),
    );
    const all = lessons.flatMap((l) => l.exercises);
    const i = all.findIndex((e) => e.id === ex.id);
    ui.prev.disabled = i <= 0;
    ui.next.disabled = i >= all.length - 1;
    ui.next.classList.toggle('btn-primary', !!progress.exercises[ex.id]?.passed);
  }

  private renderChecks(justPassed: boolean): void {
    const card = this.d.ui.scroll.querySelector('.checks-card');
    const report = this.report;
    if (!card || !report) return;
    const passedCount = report.items.filter((i) => i.passed).length;
    card.querySelector('.checks-summary')!.textContent = `${passedCount} of ${report.items.length}`;
    const banner = card.querySelector<HTMLElement>('.checks-banner')!;
    banner.hidden = !report.passed;
    banner.className = `checks-banner${justPassed ? ' fresh' : ''}`;
    banner.innerHTML = report.passed
      ? `<strong>✓ Exercise complete.</strong> ${this.isLast() ? 'That\'s the last one for now.' : 'On to the next one when you\'re ready.'}`
      : '';

    const list = card.querySelector('.checks')!;
    list.replaceChildren(...report.items.map((item) => this.checkItem(item)));
  }

  private checkItem(item: CheckItem): HTMLElement {
    const li = html(`<li class="check ${item.passed ? 'ok' : 'todo'}">
      <span class="check-icon">${item.passed ? '✓' : '○'}</span>
      <div class="check-body">
        <div class="check-label">${esc(item.label)}</div>
        ${!item.passed && item.detail ? `<div class="check-detail">${esc(item.detail)}</div>` : ''}
      </div>
    </li>`);
    const body = li.querySelector('.check-body')!;
    if (!item.passed && item.call) {
      const btn = html(`<button class="btn btn-small">Step into this call</button>`) as HTMLButtonElement;
      btn.addEventListener('click', () => this.d.debug.stepCall(item.call!));
      body.append(btn);
    }
    if (!item.passed && item.images) {
      const det = html(`<details class="diff"><summary>Compare with the target</summary>
        <div class="diff-row">
          <figure><canvas></canvas><figcaption>yours</figcaption></figure>
          <figure><canvas></canvas><figcaption>target</figcaption></figure>
          <figure><canvas></canvas><figcaption>differs (red)</figcaption></figure>
        </div></details>`);
      const [a, b, c] = det.querySelectorAll('canvas');
      paintImage(a, item.images.yours);
      paintImage(b, item.images.target);
      paintImage(c, item.images.diff);
      body.append(det);
    }
    return li;
  }

  private predictCard(): HTMLElement {
    const spec = this.exercise.config.predict!;
    const card = html(`<section class="card predict-card"><div class="card-title">Predict first</div>${md(spec.question)}<div class="predict-input"></div><div class="predict-result"></div></section>`);
    const input = card.querySelector('.predict-input')!;
    const result = card.querySelector<HTMLElement>('.predict-result')!;

    const showResult = (said: string, r: Reveal) => {
      input.replaceChildren();
      const edited = this.code.replace(/\s+/g, '') !== this.starter.replace(/\s+/g, '');
      const note = edited
        ? `<p class="muted predict-note">Graded on the starter code, so your edits don't change the answer.${this.ast ? ' The Debugger shows your current code at that pixel.' : ''}</p>`
        : '';
      result.innerHTML = `<p class="${r.correct ? 'right' : 'wrong'}">${r.correct ? '✓ Right' : '✗ Not quite'}: you said <strong>${esc(said)}</strong>, and it's <strong>${esc(r.actual)}</strong>.</p>${spec.explain ? md(spec.explain) : ''}${note}`;
      const again = html(`<button class="btn btn-small btn-quiet">Ask me again</button>`);
      again.addEventListener('click', () => {
        delete this.state.predicted;
        saveProgress(this.d.progress);
        card.replaceWith(this.predictCard());
      });
      result.append(again);
    };

    const reveal = (answer: number, answerLabel: string) => {
      const r = revealPrediction(this.exercise, answer);
      if ('error' in r) {
        result.innerHTML = `<p class="warn">Couldn't work out the answer: ${esc(r.error)}</p>`;
        return;
      }
      this.state.predicted = { answer: answerLabel };
      saveProgress(this.d.progress);
      showResult(answerLabel, r);
      // Step through the pixel the question was about, in the learner's own code.
      if (this.ast) this.d.debug.stepPixel(r.pixel, r.uniforms);
    };

    const said = this.state.predicted?.answer;
    const savedAnswer = said === undefined ? null : answerFromLabel(spec, said);
    const saved = savedAnswer === null ? null : revealPrediction(this.exercise, savedAnswer);
    if (said !== undefined && saved && !('error' in saved)) {
      showResult(said, saved);
    } else if (spec.kind === 'number') {
      const form = html(`<form class="predict-form"><input type="number" step="any" required placeholder="your guess" aria-label="Your prediction" /><button class="btn">Reveal</button></form>`) as HTMLFormElement;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = (form.querySelector('input') as HTMLInputElement).valueAsNumber;
        if (Number.isFinite(v)) reveal(v, String(v));
      });
      input.append(form);
    } else {
      for (const [i, c] of (spec.choices ?? []).entries()) {
        const b = html(`<button class="btn choice">${swatch(c.value)}${esc(c.label)}</button>`);
        b.addEventListener('click', () => reveal(i, c.label));
        input.append(b);
      }
    }
    return card;
  }

  // ---------- tutor: the hint ladder ----------

  private tutorCard(): HTMLElement {
    const card = html(`<section class="card tutor-card">
      <div class="card-title">Stuck? <span class="muted">· hints, never the answer</span></div>
      <ol class="hints"></ol>
      <p class="tutor-err" hidden></p>
      <button class="btn hint-btn"></button>
    </section>`);
    const list = card.querySelector('.hints')!;
    const err = card.querySelector<HTMLElement>('.tutor-err')!;
    const btn = card.querySelector<HTMLButtonElement>('.hint-btn')!;
    const exerciseId = this.exercise.id;
    const state = this.state;

    const hintItem = (h: { level: HintLevel; text: string }) =>
      html(`<li class="hint"><span class="hint-level">${HINT_NAMES[h.level]}</span><div class="hint-text">${tutorHtml(h.text)}</div></li>`);
    // Drawn from saved state, so a hint that arrives after the learner left
    // and came back (re-rendering this card) still shows up.
    const draw = (error?: string) => {
      const hints = state.hints ?? [];
      list.replaceChildren(...hints.map(hintItem));
      const pending = this.hintsPending.has(exerciseId);
      btn.disabled = pending;
      btn.textContent = pending
        ? 'Thinking…'
        : (["I'm stuck: give me a nudge", 'Still stuck: explain the idea', 'Still stuck: walk me through it'][hints.length] ?? 'Explain the steps another way');
      btn.hidden = hints.length >= MAX_HINTS;
      err.hidden = !error;
      err.innerHTML = error ? tutorInlineHtml(error) : '';
    };
    this.redrawHints = draw;
    draw();

    btn.addEventListener('click', async () => {
      if (this.hintsPending.has(exerciseId)) return;
      const hints = (state.hints ??= []);
      const level = Math.min(3, hints.length + 1) as HintLevel;
      const context = { ...this.d.tutorContext(), checks: this.checkSummary(), trace: this.d.debug.snapshot() ?? undefined };
      this.hintsPending.add(exerciseId);
      draw();
      let error: string | undefined;
      try {
        const r = await askTutor({ kind: 'hint', level, previous: hints.map((h) => h.text), context });
        // Keep it even if the learner moved on: it's theirs when they come back.
        hints.push({ level, text: r.text });
        saveProgress(this.d.progress);
      } catch (e) {
        error = (e as Error).message;
      } finally {
        this.hintsPending.delete(exerciseId);
      }
      if (this.exercise.id !== exerciseId) return;
      this.redrawHints?.(error);
      if (!error) this.d.ui.scroll.querySelector('.tutor-card')?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
    return card;
  }

  private isLast(): boolean {
    const all = this.d.lessons.flatMap((l) => l.exercises);
    return all[all.length - 1].id === this.exercise.id;
  }
}

function md(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

function html(markup: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function swatch(v: number | number[]): string {
  const rgb = Array.isArray(v) ? v : [v, v, v];
  if (rgb.length < 3) return '';
  const c = rgb.slice(0, 3).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255));
  return `<span class="swatch-chip" style="background: rgb(${c.join(',')})"></span>`;
}
