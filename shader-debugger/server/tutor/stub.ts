import type { TutorRequest, TutorResponse } from '../../shared/tutor';
import type { TutorProvider } from './provider';

/** Placeholder until the Claude provider lands (M4). */
export class StubProvider implements TutorProvider {
  readonly name = 'stub';
  readonly live = false;

  async complete(req: TutorRequest): Promise<TutorResponse> {
    return {
      provider: this.name,
      text: `Tutor not connected yet (M4). Received a "${req.kind}" request.`,
    };
  }
}
