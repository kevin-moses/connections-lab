import './style.css';
import { createEditor } from './editor/editor';
import { ShaderRunner } from './render/runner';
import { parseGlsl } from './glsl/parse';
import type { ShaderDiagnostic } from './glsl/diagnostics';
import type { TutorHealth } from '../shared/tutor';
import { DEFAULT_SHADER } from './defaultShader';
import { Inspector } from './probe/inspector';
import { Debugger } from './debugger/debugger';

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
  statusTutor: $('status-tutor'),
  problems: $<HTMLUListElement>('problems'),
  problemCount: $('problem-count'),
  inspect: $<HTMLButtonElement>('inspect'),
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

const editor = createEditor(
  ui.editor,
  loadSource(),
  (source) => {
    saveSource(source);
    clearTimeout(compileTimer);
    compileTimer = window.setTimeout(() => compile(source), COMPILE_DEBOUNCE_MS);
  },
  () => {
    clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(() => inspector?.onCursor(), CURSOR_DEBOUNCE_MS);
  },
);

if (runner) {
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
} else {
  ui.inspect.disabled = true;
}

function compile(source: string) {
  const parsed = parseGlsl(source);

  if (!runner) return;
  const result = runner.compile(source);

  if (result.ok) {
    setPill(ui.statusCompile, `GPU ✓ ${result.ms.toFixed(0)}ms`, 'ok', 'Compiled and linked');
  } else {
    const n = result.diagnostics.filter((d) => d.severity === 'error').length;
    setPill(ui.statusCompile, `GPU ✗ ${n} error${n === 1 ? '' : 's'}`, 'error', 'Showing the last shader that compiled');
  }

  // The debugger needs an AST. If the GPU accepts code our parser rejects,
  // flag it: that's a parser gap, not the learner's mistake.
  if (parsed.ok) {
    setPill(ui.statusAst, `AST ✓ ${parsed.ms.toFixed(1)}ms`, 'ok', 'Debugger parser understood this shader');
  } else if (result.ok) {
    setPill(ui.statusAst, 'AST ✗', 'warn', `Debugger parser gap (GPU accepted it): ${parsed.diagnostic.message}`);
  } else {
    setPill(ui.statusAst, 'AST ✗', 'idle', parsed.diagnostic.message);
  }

  editor.showDiagnostics(result.diagnostics);
  renderProblems(result.diagnostics, (line) => editor.jumpToLine(line));
  inspector?.setSource(source, parsed.ok && result.ok ? parsed.ast : null);
  debug?.setSource(parsed.ok ? parsed.ast : null, result.ok);
  // New errors while not debugging: bring the Problems tab forward.
  if (!result.ok && !debug?.active) debug?.showTab('problems');
}

compile(editor.getSource());

if (runner) {
  const r = runner;
  let lastReadout = 0;
  r.onFrame = (info) => {
    const now = performance.now();
    if (now - lastReadout < 100) return;
    lastReadout = now;
    ui.time.textContent = info.time.toFixed(2);
    ui.res.textContent = `${info.width}×${info.height}`;
    ui.fps.textContent = info.fps ? info.fps.toFixed(0) : '–';
  };
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
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: DEFAULT_SHADER } });
});

// ---------- tutor proxy health ----------

fetch('/api/health')
  .then((r) => (r.ok ? (r.json() as Promise<TutorHealth>) : Promise.reject(r.status)))
  .then((h) =>
    setPill(ui.statusTutor, `Tutor: ${h.provider}`, h.live ? 'ok' : 'idle', h.live ? 'Tutor connected' : 'Proxy up; model not connected until M4'),
  )
  .catch(() => setPill(ui.statusTutor, 'Tutor offline', 'warn', 'Start the API with `npm run dev`'));
