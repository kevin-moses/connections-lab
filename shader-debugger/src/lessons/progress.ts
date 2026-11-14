import type { GlslStyle } from '../glsl/prepare';

/** Per-viewer lesson progress, kept in localStorage (may be unavailable). */

export interface ExerciseProgress {
  code?: string;
  passed?: boolean;
  /** The learner's answer as shown; it is re-graded on display, never stored graded. */
  predicted?: { answer: string };
  /** Tutor hints shown so far, oldest first. */
  hints?: { level: 1 | 2 | 3; text: string }[];
}

export interface Progress {
  mode: 'lessons' | 'sandbox';
  /** How code is shown: GLSL ES 3.00, or p5 style (ES 1.00). */
  style: GlslStyle;
  /** The sandbox's view: a fragment shader on a canvas, or vertex + fragment on a mesh. */
  view?: 'canvas' | 'mesh';
  /** Exercise id the learner was last on. */
  current: string | null;
  exercises: Record<string, ExerciseProgress>;
}

const KEY = 'shader-debugger:progress:v1';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Progress>;
      return { mode: p.mode ?? 'lessons', style: p.style ?? 'es300', view: p.view === 'mesh' ? 'mesh' : 'canvas', current: p.current ?? null, exercises: p.exercises ?? {} };
    }
  } catch {
    /* fall through to a fresh start */
  }
  return { mode: 'lessons', style: 'es300', current: null, exercises: {} };
}

let saveTimer = 0;
let pending: Progress | null = null;

function write(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: progress lasts for this visit only */
  }
}

/** Debounced: code changes on every keystroke. A pending save is flushed when the page goes away. */
export function saveProgress(p: Progress): void {
  clearTimeout(saveTimer);
  pending = p;
  saveTimer = window.setTimeout(() => {
    pending = null;
    write(p);
  }, 300);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!pending) return;
    clearTimeout(saveTimer);
    write(pending);
    pending = null;
  });
}
