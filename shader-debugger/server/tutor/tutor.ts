import { createHash } from 'node:crypto';
import type { TutorRequest, TutorResponse } from '../../shared/tutor';
import { Lru } from '../../shared/lru';
import { screenOutput } from './filter';
import type { ExerciseMaterial, MaterialLoader } from './material';
import { buildCall, cannedAnswer, stricterRetry } from './prompts';
import type { LanguageModel, ModelCall } from './provider';
import { TutorError } from './provider';

type Answer = { text: string; model: string; fallback?: boolean };

/**
 * The tutor: request → prompt (with exercise material from disk) → model →
 * no-code screen (one stricter retry, then a canned nudge) → cache.
 */
export class Tutor {
  /** Keyed by a hash of the exact prompt. */
  private readonly cache = new Lru<Answer>(500);

  constructor(
    private readonly model: LanguageModel,
    private readonly loadMaterial: MaterialLoader,
  ) {}

  async complete(req: TutorRequest, signal?: AbortSignal): Promise<TutorResponse> {
    const ctx = req.context;
    let material: ExerciseMaterial | null = null;
    if (ctx.exerciseId) {
      material = await this.loadMaterial(ctx.exerciseId);
      if (!material) throw new TutorError(`Unknown exercise "${ctx.exerciseId}".`, 400);
    }
    const call = buildCall(req, material);

    const key = createHash('sha256').update(JSON.stringify([call.tier, call.system, call.exercise, call.user])).digest('hex');
    const hit = this.cache.get(key);
    if (hit) return { ...hit, provider: this.model.name, cached: true };

    // Quoting their own code or the exercise prompt is always fine.
    const quotable = `${ctx.code}\n${material?.prompt ?? ''}`;
    // A known exercise is exercise mode (no solution code); otherwise the sandbox.
    const answer = await this.answer(req, call, !!material, quotable, signal);
    this.cache.set(key, answer);
    return { ...answer, provider: this.model.name };
  }

  private async answer(req: TutorRequest, call: ModelCall, exerciseMode: boolean, quotable: string, signal?: AbortSignal): Promise<Answer> {
    let attempt = call;
    for (let i = 0; i < 2; i++) {
      const r = await this.model.generate(attempt, signal);
      if (r.refused) {
        return { text: "I can't help with that one. Try stepping through a pixel in the Debugger instead.", model: r.model, fallback: true };
      }
      const screen = screenOutput(r.text, { exerciseMode, learnerCode: quotable });
      if (screen.ok) return { text: r.text, model: r.model };
      console.warn(`[tutor] screened out (${screen.reason}); ${i === 0 ? 'retrying' : 'using canned answer'}`);
      attempt = stricterRetry(call, screen.reason);
    }
    return { text: cannedAnswer(req), model: 'canned', fallback: true };
  }
}
