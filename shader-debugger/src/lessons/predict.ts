import type { Program } from '@shaderfrog/glsl-parser/ast';
import { traceFragment } from '../interp/interpreter';
import { formatNumber, isArrayValue } from '../interp/values';
import { parseGlsl } from '../glsl/parse';
import { DEFAULT_CANVAS, type Exercise, type PredictSpec } from './types';

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
function gradePrediction(spec: PredictSpec, value: number[], answer: number): Grade {
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

export interface Reveal {
  correct: boolean;
  /** The true answer, as shown to the learner (a choice label or a number). */
  actual: string;
  /** Where to open the stepper. */
  pixel: [number, number];
  uniforms: PredictionRun['uniforms'];
}

/** The question's value on each exercise's starter (null: it didn't parse). It never changes, so run it once. */
const starterRuns = new Map<string, PredictionRun | null>();

function starterRun(ex: Exercise, spec: PredictSpec): PredictionRun | null {
  if (!starterRuns.has(ex.id)) {
    const parsed = parseGlsl(ex.starter);
    starterRuns.set(ex.id, parsed.ok ? runPrediction(spec, parsed.ast, ex.config.canvas ?? DEFAULT_CANVAS) : null);
  }
  return starterRuns.get(ex.id)!;
}

/**
 * Grade an answer to an exercise's prediction question. Every question is
 * about the starter code (or the first change to it), so it is always graded
 * on the starter, never on the learner's current code: once they've made the
 * change, re-running the question's expression on their code would apply it
 * twice. `answer` is a number, or a choice index.
 */
export function revealPrediction(ex: Exercise, answer: number): Reveal | { error: string } {
  const spec = ex.config.predict;
  if (!spec) return { error: 'This exercise has no prediction.' };
  const run = starterRun(ex, spec);
  if (!run) return { error: "The starter code didn't parse." };
  if (!run.value) return { error: run.error ?? 'No value.' };
  const g = gradePrediction(spec, run.value, answer);
  const actual = spec.kind === 'choice' ? spec.choices![g.correctChoice!].label : g.actualText;
  return { correct: g.correct, actual, pixel: run.pixel, uniforms: run.uniforms };
}

/** Turn a saved answer label back into what `revealPrediction` takes. */
export function answerFromLabel(spec: PredictSpec, label: string): number | null {
  if (spec.kind === 'choice') {
    const i = (spec.choices ?? []).findIndex((c) => c.label === label);
    return i >= 0 ? i : null;
  }
  const n = Number(label);
  return Number.isFinite(n) ? n : null;
}
