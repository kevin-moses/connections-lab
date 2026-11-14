/**
 * Contract between the browser and the tutor proxy. The browser never talks to
 * a model directly; it sends one of these to /api/tutor and the server builds
 * the prompt (adding the exercise's prompt and teacher notes from disk, never
 * the reference solution), calls a model, and screens the answer.
 */

export type HintLevel = 1 | 2 | 3;

/** One check from the lesson checklist. */
export interface CheckSummary {
  label: string;
  passed: boolean;
  detail?: string;
}

/** What the stepper shows right now, if a pixel (or call) is being debugged. */
export interface TraceSnapshot {
  /** Pixel coordinates (origin bottom-left), or null when stepping a function call. */
  pixel: [number, number] | null;
  call: string | null;
  /** 1-based line of the current step. */
  line: number;
  /** The step's description, e.g. `d = -0.421`. */
  step: string;
  /** Variables in scope after this step, already formatted. */
  vars: { name: string; value: string }[];
  /** Final output color of the pixel, formatted. */
  output: string | null;
}

export interface CodeContext {
  /** Learner's current source, as shown in the editor. */
  code: string;
  /** 1-based line the cursor is on. */
  cursorLine?: number;
  /**
   * `lessonId/exerciseSlug`, e.g. `03-step/03-rectangle`. Present while solving
   * an exercise, which is also what tells the server not to output solution code.
   */
  exerciseId?: string;
  /** Current compile errors, mapped to the learner's lines. */
  errors?: { line: number | null; message: string }[];
  /** Latest checklist results (lessons only). */
  checks?: CheckSummary[];
  trace?: TraceSnapshot;
}

export type TutorRequest =
  /** Plain-words explanation of a compile error. */
  | { kind: 'error'; error: { line: number | null; message: string }; context: CodeContext }
  /** "I'm stuck": the hint ladder. `previous` = hints already shown, oldest first. */
  | { kind: 'hint'; level: HintLevel; previous?: string[]; context: CodeContext };

export interface TutorResponse {
  text: string;
  provider: string;
  model?: string;
  cached?: boolean;
  /** The model's answer broke the no-code rule and was replaced with a canned nudge. */
  fallback?: boolean;
}

export interface TutorHealth {
  ok: boolean;
  provider: string;
  /** True when a real model is configured. */
  live: boolean;
  /** Why the tutor isn't live, when it isn't. */
  reason?: string;
}

/** Error body from /api/tutor. `message` is safe to show the learner. */
export interface TutorErrorBody {
  error: string;
}
