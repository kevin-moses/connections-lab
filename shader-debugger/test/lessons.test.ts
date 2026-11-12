import { describe, expect, it } from 'vitest';
import { LESSONS } from '../src/lessons/content';
import { checkExercise, diffImages, type Image } from '../src/lessons/checker';
import { cpuRenderer } from '../src/lessons/cpuRender';
import { gradePrediction, runPrediction } from '../src/lessons/predict';
import { parseGlsl } from '../src/glsl/parse';
import { DEFAULT_CANVAS } from '../src/lessons/types';

const exercises = LESSONS.flatMap((l) => l.exercises);

/** What each predict question's explanation says the starter produces. */
const PREDICTED: Record<string, number | string> = {
  '01-coordinates/01-red-ramp': 0.25,
  '01-coordinates/02-uv-as-color': 'Green',
  '01-coordinates/03-center-origin': -1,
  '01-coordinates/04-aspect-ratio': 1,
  '02-color/01-p5-colors': 'Yellow',
  '02-color/02-swizzle': 'Cyan (0, 1, 1)',
  '02-color/03-mix': 0.325,
  '02-color/04-out-of-range': 'Black (0)',
  '02-color/05-time': 0,
  '03-step/01-hard-edge': 0,
  '03-step/02-bands': 0,
  '03-step/03-rectangle': 0,
  '03-step/04-rect-function': 'Black',
  '03-step/05-smoothstep': 0.5,
};

describe('lesson content', () => {
  it('loads lessons 1–3 in order', () => {
    expect(LESSONS.map((l) => [l.title, l.exercises.length])).toEqual([
      ['Coordinates & uv', 4],
      ['Color', 5],
      ['step & thresholds', 5],
    ]);
    for (const ex of exercises) {
      expect(ex.prompt.length, ex.id).toBeGreaterThan(50);
      expect(ex.notes.length, ex.id).toBeGreaterThan(50);
    }
  });

  describe.each(exercises.map((e) => [e.id, e] as const))('%s', (_id, ex) => {
    it('reference passes every check', () => {
      const report = checkExercise(ex, ex.reference, cpuRenderer);
      const failed = report.items.filter((i) => !i.passed).map((i) => `${i.label}: ${i.detail}`);
      expect(failed).toEqual([]);
      expect(report.items.length).toBeGreaterThan(1);
    });

    it('starter fails at least one check', () => {
      expect(checkExercise(ex, ex.starter, cpuRenderer).passed).toBe(false);
    });

    it('predict question resolves to what its explanation says', () => {
      const spec = ex.config.predict!;
      expect(spec, 'every exercise has a prediction').toBeDefined();
      const parsed = parseGlsl(ex.starter);
      if (!parsed.ok) throw new Error(parsed.diagnostic.message);
      const run = runPrediction(spec, parsed.ast, ex.config.canvas ?? DEFAULT_CANVAS);
      expect(run.error).toBeUndefined();
      const expected = PREDICTED[ex.id];
      if (spec.kind === 'number') {
        expect(gradePrediction(spec, run.value!, expected as number).correct).toBe(true);
      } else {
        const idx = spec.choices!.findIndex((c) => c.label === expected);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(gradePrediction(spec, run.value!, idx).correct).toBe(true);
      }
    });
  });
});

describe('checker details', () => {
  const solid = (w: number, h: number, rgb: number[]): Image => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
    return { width: w, height: h, data };
  };

  it('diffs images within a tolerance and marks mismatches red', () => {
    const a = solid(4, 4, [100, 100, 100]);
    const b = solid(4, 4, [103, 100, 100]);
    expect(diffImages(a, b, 0.02).matchFraction).toBe(1);
    b.data.set([200, 100, 100, 255], 0);
    const d = diffImages(a, b, 0.02);
    expect(d.matchFraction).toBe(15 / 16);
    expect(d.diff.data[0]).toBeGreaterThan(200);
  });

  it('explains failures in plain words', () => {
    const ex = exercises.find((e) => e.id === '03-step/04-rect-function')!;
    const report = checkExercise(ex, ex.starter, cpuRenderer);
    const call = report.items.find((i) => i.kind === 'call' && !i.passed)!;
    expect(call.detail).toBe('rect(vec2(0.5), vec2(0.2), vec2(0.8)) returned 0, expected 1.');
    expect(call.call).toBe('rect(vec2(0.5), vec2(0.2), vec2(0.8))');
    const image = report.items.find((i) => i.kind === 'image')!;
    expect(image.passed).toBe(false);
    expect(image.images?.diff.width).toBe(64);
  });

  it('reports a compile error instead of running checks', () => {
    const ex = exercises[0];
    const report = checkExercise(ex, 'void main( {', cpuRenderer);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].kind).toBe('compile');
  });

  it('names the variant an image check failed under', () => {
    const ex = exercises.find((e) => e.id === '01-coordinates/04-aspect-ratio')!;
    const report = checkExercise(ex, ex.starter, cpuRenderer);
    expect(report.items.find((i) => i.kind === 'image')?.detail).toMatch(/on a 96×48 canvas/);
  });
});
