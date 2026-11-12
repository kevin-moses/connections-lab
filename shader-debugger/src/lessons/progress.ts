/** Per-viewer lesson progress, kept in localStorage (may be unavailable). */

export interface ExerciseProgress {
  code?: string;
  passed?: boolean;
  predicted?: { answer: string; correct: boolean; actual: string };
}

export interface Progress {
  mode: 'lessons' | 'sandbox';
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
      return { mode: p.mode ?? 'lessons', current: p.current ?? null, exercises: p.exercises ?? {} };
    }
  } catch {
    /* fall through to a fresh start */
  }
  return { mode: 'lessons', current: null, exercises: {} };
}

let saveTimer = 0;

/** Debounced: code changes on every keystroke. */
export function saveProgress(p: Progress): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* storage blocked: progress lasts for this visit only */
    }
  }, 300);
}
