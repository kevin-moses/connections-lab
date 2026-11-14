/** Fast for one-line explainers, strong for errors and hints. */
export type ModelTier = 'fast' | 'strong';

export interface ModelCall {
  tier: ModelTier;
  /** Stable instructions, identical for every request. */
  system: string;
  /** Per-exercise material (prompt, teacher notes); stable while on one exercise. */
  exercise: string | null;
  /** The question itself, with the learner's code and state. */
  user: string;
  maxTokens: number;
}

export interface ModelResult {
  text: string;
  model: string;
  /** The model declined to answer. */
  refused?: boolean;
}

/**
 * The swappable part: anything that turns a prompt into text. Claude today
 * (claude.ts); a local model or a fake for tests tomorrow.
 */
export interface LanguageModel {
  readonly name: string;
  /** True when backed by a real model. */
  readonly live: boolean;
  /** `signal` aborts the call when the learner no longer needs the answer. */
  generate(call: ModelCall, signal?: AbortSignal): Promise<ModelResult>;
}

/** A failure whose message is safe to show the learner. */
export class TutorError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}
