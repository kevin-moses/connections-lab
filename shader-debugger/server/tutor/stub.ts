import type { LanguageModel, ModelCall, ModelResult } from './provider';
import { TutorError } from './provider';

/** Stands in when no API key is configured: every request explains how to connect one. */
export class StubModel implements LanguageModel {
  readonly name = 'stub';
  readonly live = false;

  async generate(_call: ModelCall, _signal?: AbortSignal): Promise<ModelResult> {
    throw new TutorError('The tutor is not connected. Add ANTHROPIC_API_KEY to .env and restart `npm run dev`.', 503);
  }
}
