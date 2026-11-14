import type { TraceResult } from '../interp/interpreter';
import { DISCARD_SENTINEL } from '../render/runner';

export interface CrossCheck {
  status: 'match' | 'mismatch' | 'unavailable';
  cpu: number[] | null;
  gpu: number[] | null;
  /** Largest per-component difference. */
  maxDiff: number;
  message: string;
}

/** Per-component tolerance: float32 math on CPU vs GPU drifts a little. */
export const tolerance = (gpu: number) => 1e-3 + 1e-3 * Math.abs(gpu);

/**
 * Compare the interpreter's final output with what the GPU produced for the
 * same pixel and uniforms. A mismatch means the stepper may be showing
 * values the GPU doesn't compute, so the UI warns about it.
 */
export function crossCheck(trace: TraceResult, gpu: number[] | null, subject: 'pixel' | 'vertex' = 'pixel'): CrossCheck {
  if (trace.error) return { status: 'unavailable', cpu: null, gpu, maxDiff: 0, message: 'The stepper stopped early, so there is nothing to compare.' };
  if (!gpu) return { status: 'unavailable', cpu: null, gpu: null, maxDiff: 0, message: 'No compiled shader to compare against.' };

  // The sentinel round-trips through a float32 texture, so compare loosely.
  const gpuDiscarded = gpu[0] <= DISCARD_SENTINEL * 0.5;
  if (trace.discarded || gpuDiscarded) {
    return trace.discarded && gpuDiscarded
      ? { status: 'match', cpu: null, gpu: null, maxDiff: 0, message: 'Both discarded this pixel.' }
      : {
          status: 'mismatch',
          cpu: trace.output?.value.data ?? null,
          gpu: gpuDiscarded ? null : gpu,
          maxDiff: Infinity,
          message: trace.discarded ? 'The stepper discarded this pixel but the GPU drew it.' : 'The GPU discarded this pixel but the stepper drew it.',
        };
  }

  const cpu = trace.output?.value.data ?? null;
  if (!cpu) return { status: 'unavailable', cpu: null, gpu, maxDiff: 0, message: 'The shader has no output variable.' };

  let maxDiff = 0;
  let ok = true;
  for (let i = 0; i < 4; i++) {
    const a = cpu[i] ?? 0;
    const b = gpu[i];
    const d = Number.isNaN(a) && Number.isNaN(b) ? 0 : Math.abs(a - b);
    maxDiff = Math.max(maxDiff, d);
    if (!(d <= tolerance(b))) ok = false;
  }
  return ok
    ? { status: 'match', cpu, gpu, maxDiff, message: `Stepper and GPU agree on this ${subject}.` }
    : { status: 'mismatch', cpu, gpu, maxDiff, message: `Stepper and GPU disagree on this ${subject}. Treat the stepper's values with care.` };
}
