/**
 * Contract between the browser and the tutor proxy. The browser never talks to
 * a model directly; it sends one of these to /api/tutor and the server picks a
 * TutorProvider (Claude today, swappable later).
 */

export type HintLevel = 1 | 2 | 3;

export interface CodeContext {
  /** Learner's current source, as shown in the editor. */
  code: string;
  /** 1-based line the cursor is on. */
  cursorLine?: number;
  lessonId?: string;
  exerciseId?: string;
  /** True while solving an exercise: the tutor must not output solution code. */
  exerciseMode?: boolean;
}

export type TutorRequest =
  | { kind: 'line'; line: string; context: CodeContext }
  | { kind: 'error'; error: { line: number | null; message: string }; context: CodeContext }
  | { kind: 'hint'; level: HintLevel; context: CodeContext };

export type TutorKind = TutorRequest['kind'];

export interface TutorResponse {
  text: string;
  provider: string;
  model?: string;
  cached?: boolean;
}

export interface TutorHealth {
  ok: boolean;
  provider: string;
  /** False until a real provider (M4) is configured. */
  live: boolean;
}
