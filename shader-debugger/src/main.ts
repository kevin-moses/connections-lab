import './style.css';
import { createEditor } from './editor/editor';
import type { Program } from '@shaderfrog/glsl-parser/ast';
import { parseGlsl, type ParseResult } from './glsl/parse';
import type { ShaderDiagnostic } from './glsl/diagnostics';
import { ShaderRunner, type CompileResult } from './render/runner';
import { Emitter } from './events';
import type { CodeContext } from '../shared/tutor';
import { DEFAULT_SHADER } from './defaultShader';
import { Inspector } from './probe/inspector';
import { Debugger } from './debugger/debugger';
import { LESSONS } from './lessons/content';
import { LessonController } from './lessons/lessonView';
import { loadProgress, saveProgress } from './lessons/progress';
import { OffscreenRenderer } from './render/offscreen';
import { addErrorExplainer } from './tutor/errorExplainer';

const STORAGE_KEY = 'shader-debugger:sandbox:v1';
const COMPILE_DEBOUNCE_MS = 200;
const CURSOR_DEBOUNCE_MS = 60;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  canvas: $<HTMLCanvasElement>('view'),
  canvasError: $('canvas-error'),
  editor: $('editor'),
  play: $<HTMLButtonElement>('play'),
  resetTime: $<HTMLButtonElement>('reset-time'),
  resetCode: $<HTMLButtonElement>('reset-code'),
  time: $('time'),
  res: $('res'),
  fps: $('fps'),
  statusCompile: $('status-compile'),
  statusAst: $('status-ast'),
  problems: $<HTMLUListElement>('problems'),
  problemCount: $('problem-count'),
  inspect: $<HTMLButtonElement>('inspect'),
  workspace: $('workspace'),
  modeSwitch: $('mode-switch'),
  lessonPane: $('lesson-pane'),
};

// ---------- persistence (per-viewer convenience; may be unavailable) ----------

function loadSource(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SHADER;
  } catch {
    return DEFAULT_SHADER;
  }
}

function saveSource(source: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    /* private mode / storage blocked: keep working without saving */
  }
}

// ---------- status helpers ----------

function setPill(el: HTMLElement, text: string, state: 'ok' | 'warn' | 'error' | 'idle', title?: string) {
  el.textContent = text;
  el.className = `pill ${state === 'idle' ? '' : state}`;
  if (title !== undefined) el.title = title;
}

function renderProblems(diags: ShaderDiagnostic[], onPick: (line: number) => void) {
  ui.problems.replaceChildren();
  const errors = diags.filter((d) => d.severity === 'error').length;
  ui.problemCount.textContent = String(diags.length);
  ui.problemCount.classList.toggle('has-errors', errors > 0);

  if (diags.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No problems. The shader compiled.';
    ui.problems.append(li);
    return;
  }

  for (const d of diags) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = `dot ${d.severity}`;
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = d.line !== null ? `Ln ${d.line}` : '—';
    const msg = document.createElement('span');
    msg.textContent = d.message;
    li.append(dot, where, msg);
    if (d.line !== null) li.addEventListener('click', () => onPick(d.line!));
    if (d.severity === 'error') addErrorExplainer(li, msg, d, tutorContext);
    ui.problems.append(li);
  }
}

// ---------- boot ----------

let runner: ShaderRunner | null = null;
try {
  runner = new ShaderRunner(ui.canvas);
} catch (err) {
  ui.canvasError.hidden = false;
  ui.canvasError.textContent = (err as Error).message;
  setPill(ui.statusCompile, 'GPU unavailable', 'error');
}

let compileTimer = 0;
let cursorTimer = 0;
let inspector: Inspector | null = null;
let debug: Debugger | null = null;
let lessons: LessonController | null = null;
let lastDiagnostics: ShaderDiagnostic[] = [];
const progress = loadProgress();

/** One compile of the editor's code: what every view updates from. */
interface Compiled {
  source: string;
  parsed: ParseResult;
  gpu: CompileResult;
  /** The AST when both the parser and the GPU accepted the code (probes need both). */
  ast: Program | null;
}
const compiled = new Emitter<Compiled>();

/** The lesson controller, while lesson mode is on (the one place that decides who owns the editor's code). */
function activeLessons(): LessonController | null {
  return progress.mode === 'lessons' ? lessons : null;
}

/** What every tutor request carries. Hints (lessonView) add the checks and the stepper's state. */
function tutorContext(): CodeContext {
  return {
    code: editor.getSource(),
    cursorLine: editor.cursorLine(),
    exerciseId: activeLessons()?.current.id,
    errors: lastDiagnostics.filter((d) => d.severity === 'error').map((d) => ({ line: d.line, message: d.message })),
  };
}

const editor = createEditor(
  ui.editor,
  '',
  (source) => {
    const owner = activeLessons();
    if (owner) owner.saveCode(source);
    else saveSource(source);
    clearTimeout(compileTimer);
    compileTimer = window.setTimeout(() => compile(source), COMPILE_DEBOUNCE_MS);
  },
  () => {
    clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(() => inspector?.onCursor(), CURSOR_DEBOUNCE_MS);
  },
);

if (runner) {
  try {
    inspector = new Inspector(runner, editor, {
      toggle: ui.inspect,
      bar: $('probe-bar'),
      expr: $('probe-expr'),
      type: $('probe-type'),
      where: $('probe-where'),
      modeSeg: $('mode-seg'),
      channelSeg: $('channel-seg'),
      iterWrap: $('iter-wrap'),
      iter: $<HTMLSelectElement>('iter'),
      legend: $('probe-legend'),
      message: $('probe-message'),
      readout: $('readout'),
      canvas: ui.canvas,
      canvasWrap: ui.canvas.parentElement!,
    });
  } catch (err) {
    // Value-as-image needs float render targets; everything else still works.
    ui.inspect.disabled = true;
    ui.inspect.title = (err as Error).message;
  }
  debug = new Debugger(runner, editor, {
    bottom: $('bottom'),
    tabDebug: $<HTMLButtonElement>('tab-debug'),
    tabProblems: $<HTMLButtonElement>('tab-problems'),
    panelDebug: $('panel-debug'),
    panelProblems: $('panel-problems'),
    empty: $('dbg-empty'),
    main: $('dbg-main'),
    pixels: $('dbg-pixels'),
    check: $('dbg-check'),
    refresh: $<HTMLButtonElement>('dbg-refresh'),
    close: $<HTMLButtonElement>('dbg-close'),
    nav: document.querySelector<HTMLElement>('.dbg-buttons')!,
    slider: $<HTMLInputElement>('dbg-slider'),
    count: $('dbg-count'),
    now: $('dbg-now'),
    vars: $<HTMLTableElement>('dbg-vars'),
    stack: $('dbg-stack'),
    markerA: $('marker-a'),
    markerB: $('marker-b'),
    canvas: ui.canvas,
    canvasWrap: ui.canvas.parentElement!,
  });
  lessons = new LessonController({
    lessons: LESSONS,
    progress,
    runner,
    debug,
    renderer: new OffscreenRenderer(),
    ui: {
      pane: ui.lessonPane,
      select: $<HTMLSelectElement>('lesson-select'),
      dots: $('ex-dots'),
      scroll: $('lesson-scroll'),
      prev: $<HTMLButtonElement>('ex-prev'),
      next: $<HTMLButtonElement>('ex-next'),
      reset: $<HTMLButtonElement>('ex-reset'),
    },
    loadCode,
    tutorContext,
  });
} else {
  ui.inspect.disabled = true;
  progress.mode = 'sandbox';
}

/** Replace the editor's code (fresh undo history) and compile right away. */
function loadCode(code: string) {
  clearTimeout(compileTimer);
  editor.replaceDocument(code);
  compile(code);
  fitCanvas();
}

// ---------- modes ----------

function setMode(mode: 'lessons' | 'sandbox') {
  progress.mode = mode;
  saveProgress(progress);
  const isLessons = mode === 'lessons' && !!lessons;
  ui.lessonPane.hidden = !isLessons;
  ui.workspace.classList.toggle('with-lesson', isLessons);
  ui.resetCode.hidden = isLessons;
  for (const b of ui.modeSwitch.querySelectorAll<HTMLButtonElement>('button')) {
    b.classList.toggle('active', b.dataset.mode === mode);
  }
  if (isLessons) {
    lessons!.open(lessons!.current.id);
  } else {
    runner?.setFixedSize(null);
    debug?.close();
    loadCode(loadSource());
  }
}

ui.modeSwitch.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
  if (b && b.dataset.mode !== progress.mode) setMode(b.dataset.mode as 'lessons' | 'sandbox');
});

/** Lessons use an exact canvas size; letterbox it into the available space. */
function fitCanvas() {
  const size = runner?.fixed;
  const canvas = ui.canvas;
  if (!size) {
    canvas.classList.remove('fixed');
    canvas.style.width = canvas.style.height = '';
    return;
  }
  const wrap = canvas.parentElement!;
  const pad = 28;
  const scale = Math.min((wrap.clientWidth - pad) / size[0], (wrap.clientHeight - pad) / size[1]);
  canvas.classList.add('fixed');
  canvas.style.width = `${Math.max(1, size[0] * scale)}px`;
  canvas.style.height = `${Math.max(1, size[1] * scale)}px`;
}
new ResizeObserver(fitCanvas).observe(ui.canvas.parentElement!);

function compile(source: string) {
  if (!runner) return;
  const parsed = parseGlsl(source);
  const gpu = runner.compile(source);
  compiled.emit({
    source,
    parsed,
    gpu,
    ast: parsed.ok && gpu.ok ? parsed.ast : null,
  });
}

compiled.on(({ parsed, gpu }) => {
  if (gpu.ok) {
    setPill(ui.statusCompile, `GPU ✓ ${gpu.ms.toFixed(0)}ms`, 'ok', 'Compiled and linked');
  } else {
    const n = gpu.diagnostics.filter((d) => d.severity === 'error').length;
    setPill(ui.statusCompile, `GPU ✗ ${n} error${n === 1 ? '' : 's'}`, 'error', 'Showing the last shader that compiled');
  }
  // The debugger needs an AST. If the GPU accepts code our parser rejects,
  // flag it: that's a parser gap, not the learner's mistake.
  if (parsed.ok) {
    setPill(ui.statusAst, `AST ✓ ${parsed.ms.toFixed(1)}ms`, 'ok', 'Debugger parser understood this shader');
  } else if (gpu.ok) {
    setPill(ui.statusAst, 'AST ✗', 'warn', `Debugger parser gap (GPU accepted it): ${parsed.diagnostic.message}`);
  } else {
    setPill(ui.statusAst, 'AST ✗', 'idle', parsed.diagnostic.message);
  }
  lastDiagnostics = gpu.diagnostics;
  editor.showDiagnostics(gpu.diagnostics);
  renderProblems(gpu.diagnostics, (line) => editor.jumpToLine(line));
});
compiled.on(({ source, ast }) => inspector?.setSource(source, ast));
compiled.on(({ parsed, gpu }) => {
  debug?.setSource(parsed.ok ? parsed.ast : null, gpu.ok);
  // New errors while not debugging: bring the Problems tab forward.
  if (!gpu.ok && !debug?.active) debug?.showTab('problems');
});
compiled.on(({ source, ast }) => activeLessons()?.onCompiled(source, ast));

setMode(progress.mode);

if (runner) {
  const r = runner;
  let lastReadout = 0;
  r.frame.on((info) => {
    lessons?.onFrame();
    const now = performance.now();
    if (now - lastReadout < 100) return;
    lastReadout = now;
    ui.time.textContent = info.time.toFixed(2);
    ui.res.textContent = `${info.width}×${info.height}`;
    ui.fps.textContent = info.fps ? info.fps.toFixed(0) : '–';
  });
  r.start();

  ui.play.addEventListener('click', () => {
    r.setPlaying(!r.isPlaying);
    ui.play.textContent = r.isPlaying ? 'Pause' : 'Play';
    ui.play.title = r.isPlaying ? 'Pause time' : 'Resume time';
  });
  ui.resetTime.addEventListener('click', () => r.resetTime());
}

ui.resetCode.addEventListener('click', () => {
  const view = editor.view;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: DEFAULT_SHADER },
  });
});

// Dev-only handle for poking at the app from the browser console / tests.
if (import.meta.env.DEV) {
  (window as unknown as { __sd: unknown }).__sd = {
    editor,
    lessons,
    runner,
    debug,
    progress,
    tutorContext,
  };
}
