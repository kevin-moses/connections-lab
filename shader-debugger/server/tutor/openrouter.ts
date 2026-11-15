import type { OpenRouter } from '@openrouter/sdk';
import * as errors from '@openrouter/sdk/models/errors';
import type { LanguageModel, ModelCall, ModelResult, ModelTier } from './provider';
import { TutorError } from './provider';

/** NVIDIA's Nemotron 3 Ultra, free on OpenRouter. Override with TUTOR_MODEL_FAST / TUTOR_MODEL_STRONG. */
export const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
export const DEFAULT_MODELS: Record<ModelTier, string> = { fast: DEFAULT_MODEL, strong: DEFAULT_MODEL };

/** Nemotron reasons before it answers: keep that short for one-liners. Reasoning shares the token budget. */
const EFFORT: Record<ModelTier, 'low' | 'medium'> = { fast: 'low', strong: 'medium' };

/** Free models can queue; give up before the learner does. */
const TIMEOUT_MS = 90_000;

export class OpenRouterModel implements LanguageModel {
  readonly name = 'openrouter';
  readonly live = true;

  constructor(
    private readonly client: OpenRouter,
    private readonly models: Record<ModelTier, string> = DEFAULT_MODELS,
  ) {}

  async generate(call: ModelCall, signal?: AbortSignal): Promise<ModelResult> {
    const system = call.exercise ? `${call.system}\n\n${call.exercise}` : call.system;
    let response: Awaited<ReturnType<OpenRouter['chat']['send']>>;
    try {
      response = await this.client.chat.send(
        {
          chatRequest: {
            model: this.models[call.tier],
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: call.user },
            ],
            maxTokens: call.maxTokens,
            // The tutor only shows the answer, so don't send the reasoning back.
            reasoning: { effort: EFFORT[call.tier], exclude: true },
            stream: false,
          },
        },
        { signal, timeoutMs: TIMEOUT_MS },
      );
    } catch (err) {
      throw toTutorError(err);
    }

    const choice = response.choices[0];
    if (!choice) throw new TutorError('The tutor returned an empty answer.');
    if (choice.finishReason === 'content_filter' || choice.message.refusal) {
      return { text: '', model: response.model, refused: true };
    }
    const content = choice.message.content;
    const text = (typeof content === 'string' ? content : (content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('')).trim();
    if (!text) {
      throw new TutorError(
        choice.finishReason === 'length' ? 'The tutor ran out of room before answering. Try again.' : 'The tutor returned an empty answer.',
      );
    }
    return { text, model: response.model };
  }
}

/** SDK errors → messages a learner can act on. */
export function toTutorError(err: unknown): TutorError {
  // The learner moved on; nobody is waiting for this, so don't log it.
  if (err instanceof errors.RequestAbortedError) return new TutorError('Cancelled.', 499);
  if (err instanceof errors.UnauthorizedResponseError || err instanceof errors.ForbiddenResponseError) {
    return new TutorError('The tutor\'s API key was rejected. Check OPENROUTER_API_KEY in .env.', 503);
  }
  if (err instanceof errors.PaymentRequiredResponseError) {
    return new TutorError('The tutor\'s OpenRouter account is out of credit.', 503);
  }
  if (err instanceof errors.NotFoundResponseError) {
    return new TutorError('The tutor model wasn\'t found. Check TUTOR_MODEL_FAST / TUTOR_MODEL_STRONG in .env.', 503);
  }
  if (err instanceof errors.TooManyRequestsResponseError) {
    // Free models have per-minute and per-day limits on OpenRouter.
    return new TutorError('The tutor is busy (rate limited). Try again in a moment.', 429);
  }
  if (err instanceof errors.ProviderOverloadedResponseError || err instanceof errors.ServiceUnavailableResponseError) {
    return new TutorError('The tutor model is overloaded right now. Try again in a moment.', 503);
  }
  if (err instanceof errors.RequestTimeoutError || err instanceof errors.GatewayTimeoutResponseError || err instanceof errors.EdgeNetworkTimeoutResponseError) {
    return new TutorError('The tutor took too long to answer. Try again.', 504);
  }
  if (err instanceof errors.ConnectionError) {
    return new TutorError('Couldn\'t reach the tutor. Check your internet connection.', 503);
  }
  if (err instanceof errors.BadRequestResponseError) {
    console.error('[tutor] bad request:', err.message);
    return new TutorError('The tutor couldn\'t handle that request.', 502);
  }
  if (err instanceof errors.OpenRouterError) {
    console.error('[tutor] API error', err.statusCode, err.message);
    return new TutorError('The tutor had a problem. Try again.', 502);
  }
  console.error('[tutor]', err);
  return new TutorError('The tutor had a problem. Try again.', 502);
}
