import Anthropic from '@anthropic-ai/sdk';
import type { LanguageModel, ModelCall, ModelResult, ModelTier } from './provider';
import { TutorError } from './provider';

/** Defaults from PROPOSAL.md; override with TUTOR_MODEL_FAST / TUTOR_MODEL_STRONG. */
export const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: 'claude-haiku-5-5',
  strong: 'claude-sonnet-5-5',
};

/** One-liners don't need deep thought; hints and error explanations get a bit more. */
const EFFORT: Record<ModelTier, 'low' | 'medium'> = { fast: 'low', strong: 'medium' };

/**
 * Models that accept the server-side refusal fallback. On a safety-classifier
 * false positive (rare, but it happens on code questions) the API retries on
 * a fallback model inside the same call.
 */
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-fable-5-2']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class ClaudeModel implements LanguageModel {
  readonly name = 'claude';
  readonly live = true;

  constructor(
    private readonly client: Anthropic,
    private readonly models: Record<ModelTier, string> = DEFAULT_MODELS,
  ) {}

  async generate(call: ModelCall, signal?: AbortSignal): Promise<ModelResult> {
    const model = this.models[call.tier];
    // The system prompt and the exercise material are the stable prefix:
    // cache through the last stable block. (Below the model's minimum
    // cacheable length this is silently a no-op, which costs nothing.)
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: call.system }];
    if (call.exercise) system.push({ type: 'text', text: call.exercise });
    system[system.length - 1].cache_control = { type: 'ephemeral' };

    const withFallback = FALLBACK_MODELS.has(model);
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model,
        max_tokens: call.maxTokens,
        system,
        output_config: { effort: EFFORT[call.tier] },
        messages: [{ role: 'user', content: call.user }],
        ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      }, { signal });
    } catch (err) {
      throw toTutorError(err);
    }

    if (response.stop_reason === 'refusal') return { text: '', model: response.model, refused: true };
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) {
      throw new TutorError(
        response.stop_reason === 'max_tokens' ? 'The tutor ran out of room before answering. Try again.' : 'The tutor returned an empty answer.',
      );
    }
    return { text, model: response.model };
  }
}

/** Typed SDK errors → messages a learner can act on. */
function toTutorError(err: unknown): TutorError {
  // The learner moved on; nobody is waiting for this, so don't log it.
  if (err instanceof Anthropic.APIUserAbortError) return new TutorError('Cancelled.', 499);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new TutorError('The tutor\'s API key was rejected. Check ANTHROPIC_API_KEY in .env.', 503);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new TutorError('The tutor model wasn\'t found. Check TUTOR_MODEL_FAST / TUTOR_MODEL_STRONG in .env.', 503);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new TutorError('The tutor is busy (rate limited). Try again in a moment.', 429);
  }
  if (err instanceof Anthropic.BadRequestError) {
    console.error('[tutor] bad request:', err.message);
    return new TutorError('The tutor couldn\'t handle that request.', 502);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new TutorError('Couldn\'t reach the tutor. Check your internet connection.', 503);
  }
  if (err instanceof Anthropic.APIError) {
    console.error('[tutor] API error', err.status, err.message);
    return new TutorError('The tutor had a problem. Try again.', 502);
  }
  console.error('[tutor]', err);
  return new TutorError('The tutor had a problem. Try again.', 502);
}
