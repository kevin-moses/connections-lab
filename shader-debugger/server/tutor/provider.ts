import type { TutorRequest, TutorResponse } from '../../shared/tutor';

/**
 * Anything that can answer tutor requests. Swap implementations (Claude, a
 * local model, a fake for tests) without touching routes or the browser.
 */
export interface TutorProvider {
  readonly name: string;
  /** True when backed by a real model. */
  readonly live: boolean;
  complete(req: TutorRequest): Promise<TutorResponse>;
}
