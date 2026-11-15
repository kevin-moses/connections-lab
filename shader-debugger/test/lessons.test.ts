import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LESSONS } from '../src/lessons/content';
import { checkExercise, diffImages, type Image } from '../src/lessons/checker';
import { cpuRenderer } from '../src/lessons/cpuRender';
import { answerFromLabel, revealPrediction, runPrediction } from '../src/lessons/predict';
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
  '02-color/04-out-of-range': 'Pure blue (0, 0, 1)',
  '02-color/05-time': 'x = 0.3',
  '03-step/01-hard-edge': 0,
  '03-step/02-bands': 0,
  '03-step/03-rectangle': 0,
  '03-step/04-rect-function': 'Black',
  '03-step/05-smoothstep': 0.5,
  '04-shapes/01-ring': 0.3,
  '04-shapes/02-union': 2,
  '04-shapes/03-square': 0.17,
  '04-shapes/04-inside-outside': -0.3,
  '05-patterns/01-repeat': 0.4,
  '05-patterns/02-checkerboard': 3,
  '05-patterns/03-per-tile': 2,
  '05-patterns/04-bricks': 1,
  '06-rotation/01-rotate2d': '(1, 0): unchanged',
  '06-rotation/02-spin': 6.28,
  '06-rotation/03-slices': 1.57,
  '06-rotation/04-flower': 0.33,
  '07-hydra-blocks/01-osc': 1.59,
  '07-hydra-blocks/02-rotate': '(0.5, 0.5): it stays in the middle',
  '07-hydra-blocks/03-color': 0.3,
  '07-hydra-blocks/04-kaleid': 1.57,
  '08-hydra-stacks/01-coord-order': 0.2,
  '08-hydra-stacks/02-diff': 0.7,
  '08-hydra-stacks/03-modulate': 0.075,
  '08-hydra-stacks/04-translate': 20.94,
};

describe('lesson content', () => {
  it('loads lessons 1–8 in order', () => {
    expect(LESSONS.map((l) => [l.title, l.exercises.length])).toEqual([
      ['Coordinates & uv', 4],
      ['Color', 5],
      ['step & thresholds', 5],
      ['Shapes with distance', 4],
      ['Patterns and tiling', 4],
      ['Rotation and polar coordinates', 4],
      ["Hydra's building blocks", 4],
      ['Stacking like Hydra', 4],
    ]);
    for (const ex of exercises) {
      expect(ex.prompt.length, ex.id).toBeGreaterThan(50);
      const notes = readFileSync(`lessons/${ex.id.replace('/', '/exercises/')}/notes.md`, 'utf8');
      expect(notes.length, ex.id).toBeGreaterThan(50);
    }
  });

  it('keeps teacher notes out of the browser bundle', () => {
    for (const ex of exercises) expect(ex, ex.id).not.toHaveProperty('notes');
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
      const answer = answerFromLabel(spec, String(PREDICTED[ex.id]));
      expect(answer, 'expected answer is a valid choice').not.toBeNull();
      const r = revealPrediction(ex, answer!);
      expect(r).toMatchObject({ correct: true });
    });

    it('predict question gets the same answer once the exercise is solved', () => {
      // Regression: grading used to run the learner's current code, so once
      // they had written the line a question asked about, it was applied
      // twice (1.3 reported -2.995 instead of -1). The question is about the
      // starter; the finished solution must not change its answer.
      const spec = ex.config.predict!;
      const onStarter = runQuestion(ex.starter, ex);
      const onSolution = runQuestion(ex.reference, ex);
      const differs = onStarter.some((x, i) => Math.abs(x - onSolution[i]) > 1e-3);
      const r = revealPrediction(ex, answerFromLabel(spec, String(PREDICTED[ex.id]))!);
      expect(r).toMatchObject({ correct: true });
      // For the questions where the solution would change the value, make
      // sure grading really isn't using it.
      if (differs && spec.kind === 'number') {
        expect('actual' in r && Math.abs(Number(r.actual) - onSolution[0]) > 1e-3).toBe(true);
      }
    });
  });
});

/** Evaluate a question's expression on some code, the way the old grading did. */
function runQuestion(code: string, ex: (typeof exercises)[number]): number[] {
  const parsed = parseGlsl(code);
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  return runPrediction(ex.config.predict!, parsed.ast, ex.config.canvas ?? DEFAULT_CANVAS).value ?? [];
}

describe('checker details', () => {
  it('renders the reference once per variant, not on every check', () => {
    const ex = exercises.find((e) => e.id === '03-step/03-rectangle')!;
    const sources: string[] = [];
    const counting: typeof cpuRenderer = (req) => (sources.push(req.source), cpuRenderer(req));
    checkExercise(ex, ex.starter, counting);
    const first = sources.filter((s) => s === ex.reference).length;
    checkExercise(ex, ex.starter + '\n', counting);
    expect(first).toBeGreaterThan(0);
    expect(sources.filter((s) => s === ex.reference).length).toBe(first);
  });

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
