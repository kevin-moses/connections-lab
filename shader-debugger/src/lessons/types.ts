/**
 * Lesson content model. Lessons live in `lessons/<NN-slug>/`:
 *
 *   lesson.md                      `# Title` + intro
 *   exercises/<NN-slug>/
 *     exercise.json                ExerciseConfig
 *     prompt.md                    instructions shown to the learner
 *     starter.glsl                 code the learner starts from
 *     reference.glsl               hidden solution (target image, never sent to the tutor)
 *     notes.md                     teacher notes, read only by the tutor server (never bundled)
 *
 * All shaders are in the canonical dialect (GLSL ES 3.00, u_resolution /
 * u_time / u_mouse, `out vec4 fragColor`).
 */

/** One rendering setup to check under. Mouse is in uv (0..1); size in pixels. */
export interface Variant {
  time?: number;
  mouse?: [number, number];
  size?: [number, number];
}

export type Channel = 'r' | 'g' | 'b' | 'a' | 'luma';

export type TestSpec =
  /** Color at one point (uv). `null` components are not checked. */
  | { type: 'pixel'; label: string; at: [number, number]; expect: (number | null)[]; tol?: number; variant?: Variant }
  /** Every pixel in a uv rectangle [x0, y0, x1, y1] stays within min/max. */
  | { type: 'region'; label: string; rect: [number, number, number, number]; channel: Channel; min?: number; max?: number; variant?: Variant }
  /** A channel never decreases along a line, and rises by at least `rise` overall. */
  | { type: 'increasing'; label: string; channel: Channel; axis: 'x' | 'y'; at: number; rise?: number; variant?: Variant }
  /** Call a learner function on the CPU and compare the result. */
  | { type: 'call'; label: string; call: string; expect: number | number[]; tol?: number };

export interface PredictChoice {
  label: string;
  value: number | number[];
}

/**
 * Predict-then-reveal: before editing, the learner guesses a value; the
 * stepper then runs the *current* code at that pixel and shows the truth.
 */
export interface PredictSpec {
  /** Markdown question. */
  question: string;
  /** Pixel to run, in uv on the exercise canvas. */
  at: [number, number];
  /** Expression evaluated in main()'s scope at the end of the run. */
  expr: string;
  kind: 'number' | 'choice';
  choices?: PredictChoice[];
  /** Number answers within this distance are correct (default 0.02). */
  tolerance?: number;
  /** Compare what the screen shows (clamped to 0..1). */
  clamp?: boolean;
  time?: number;
  /** In uv. */
  mouse?: [number, number];
  /** Shown after revealing, whatever the answer. Markdown. */
  explain?: string;
}

export interface ImageCheck {
  /** Per-channel tolerance, 0..1 (default 0.02 ≈ 5/255). */
  tolerance?: number;
  /** Fraction of pixels allowed to differ (default 0.01). */
  maxMismatch?: number;
}

export interface ExerciseConfig {
  title: string;
  /** Learner canvas in pixels (default 400×400). */
  canvas?: [number, number];
  /** Image diff against the reference; false to skip. Default on. */
  image?: boolean | ImageCheck;
  /** Setups to check under (default: one 64×64 still at t = 0, mouse centered). */
  variants?: Variant[];
  tests?: TestSpec[];
  predict?: PredictSpec;
  /** The target animates (preview keeps running). */
  animated?: boolean;
}

export interface Exercise {
  /** `01-coordinates/01-red-ramp` */
  id: string;
  lessonId: string;
  index: number;
  config: ExerciseConfig;
  prompt: string;
  starter: string;
  reference: string;
}

export interface Lesson {
  id: string;
  index: number;
  title: string;
  /** Markdown after the title line. */
  intro: string;
  exercises: Exercise[];
}

export const DEFAULT_CANVAS: [number, number] = [400, 400];
export const DEFAULT_VARIANT: Required<Variant> = { time: 0, mouse: [0.5, 0.5], size: [64, 64] };
