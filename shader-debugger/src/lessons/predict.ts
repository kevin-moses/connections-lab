import type { Program } from '@shaderfrog/glsl-parser/ast';
import { traceFragment } from '../interp/interpreter';
import { formatNumber, isArrayValue } from '../interp/values';
import type { PredictSpec } from './types';

export interface PredictionRun {
  /** Pixel coordinates, origin bottom-left. */
  pixel: [number, number];
  uniforms: { resolution: [number, number]; time: number; mouse: [number, number] };
  value: number[] | null;
  error?: string;
}

/** Run the current code at the prediction's pixel and evaluate its expression. */
export function runPrediction(spec: PredictSpec, ast: Program, canvas: [number, number]): PredictionRun {
  const [w, h] = canvas;
  const pixel: [number, number] = [
    Math.min(w - 1, Math.max(0, Math.floor(spec.at[0] * w))),
    Math.min(h - 1, Math.max(0, Math.floor(spec.at[1] * h))),
  ];
  const mouse: [number, number] = spec.mouse ? [spec.mouse[0] * w, spec.mouse[1] * h] : [w / 2, h / 2];
  const uniforms = { resolution: canvas, time: spec.time ?? 0, mouse };
  const r = traceFragment(
    ast,
    { pixel, uniforms: { u_resolution: canvas, u_time: uniforms.time, u_mouse: mouse } },
    { record: false, finalExpression: spec.expr },
  );
  const err = r.error?.message ?? r.finalError ?? (r.discarded ? 'This pixel is discarded.' : undefined);
  if (err || !r.finalValue || isArrayValue(r.finalValue)) return { pixel, uniforms, value: null, error: err ?? 'No value.' };
  const raw = r.finalValue.data;
  return { pixel, uniforms, value: spec.clamp ? raw.map((x) => Math.min(1, Math.max(0, x))) : raw };
}

export interface Grade {
  correct: boolean;
  /** What the code actually produces, in words. */
  actualText: string;
  /** For choice questions: the index of the right answer. */
  correctChoice?: number;
}

/** `answer` is a number for number questions, a choice index for choices. */
export function gradePrediction(spec: PredictSpec, value: number[], answer: number): Grade {
  const actualText = value.length === 1 ? formatNumber(value[0]) : `(${value.map((x) => formatNumber(x)).join(', ')})`;
  if (spec.kind === 'number') {
    return { correct: Math.abs(answer - value[0]) <= (spec.tolerance ?? 0.02), actualText };
  }
  const choices = spec.choices ?? [];
  let best = 0;
  let bestDist = Infinity;
  choices.forEach((c, i) => {
    const cv = Array.isArray(c.value) ? c.value : [c.value];
    const d = cv.reduce((s, x, k) => s + (x - (value[k] ?? 0)) ** 2, 0);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return { correct: answer === best, actualText, correctChoice: best };
}
