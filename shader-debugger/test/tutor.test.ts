import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { OpenRouter } from '@openrouter/sdk';
import * as orErrors from '@openrouter/sdk/models/errors';
import { screenOutput, learnerVariables } from '../server/tutor/filter';
import { createMaterialLoader, MATERIAL_FILES } from '../server/tutor/material';
import { buildCall, numberLines, SYSTEM_PROMPT } from '../server/tutor/prompts';
import { Tutor } from '../server/tutor/tutor';
import { DEFAULT_MODEL, OpenRouterModel, toTutorError } from '../server/tutor/openrouter';
import type { LanguageModel, ModelCall, ModelResult } from '../server/tutor/provider';
import { TutorError } from '../server/tutor/provider';
import { parseTutorRequest } from '../server/validate';
import type { TutorRequest } from '../shared/tutor';

const LESSONS = path.resolve(__dirname, '../lessons');
const loadMaterial = createMaterialLoader(LESSONS + '/');

const RECT_STARTER = readFileSync(`${LESSONS}/03-step/exercises/03-rectangle/starter.glsl`, 'utf8');

function exerciseIds(): string[] {
  const ids: string[] = [];
  for (const lesson of readdirSync(LESSONS)) {
    const dir = `${LESSONS}/${lesson}/exercises`;
    for (const ex of readdirSync(dir)) ids.push(`${lesson}/${ex}`);
  }
  return ids.sort();
}

// ---------------------------------------------------------------------------

describe('screenOutput (exercise mode)', () => {
  const opts = { exerciseMode: true, learnerCode: RECT_STARTER };
  const ok = (text: string) => expect(screenOutput(text, opts)).toEqual({ ok: true });
  const blocked = (text: string) => expect(screenOutput(text, opts).ok).toBe(false);

  it('allows names, built-ins on placeholders, literals, and quotes of their code', () => {
    ok('Look at `bandY` on line 11: what is it at a pixel near the top?');
    ok('`step(edge, x)` returns 0 when `x` is below `edge`, and 1 otherwise.');
    ok('Compare `uv.y` with `0.3` and `0.6`.');
    ok('Your line `float rect = bandX;` only uses one band.');
    ok('`step(0.2, uv.x) * (1.0 - step(0.8, uv.x))` already builds the x band.');
  });

  it('blocks code blocks, statements, and expressions over their variables', () => {
    blocked('Try this:\n```glsl\nfloat bandY = step(0.3, uv.y) * (1.0 - step(0.6, uv.y));\n```');
    blocked('Set `rect = bandX * bandY` and you are done.');
    blocked('Multiply them: `bandX * bandY`.');
    blocked('Use `step(0.3, uv.y)` for the bottom edge.');
    blocked('Change line 12 to:\nfloat rect = bandX * bandY;');
    blocked('`vec2 p = uv * 2.0 - 1.0`');
  });

  it('allows fenced blocks that only quote their own code', () => {
    ok('This is the line that matters:\n```\nfloat rect = bandX;   // combine the two bands\n```');
  });

  it('is lenient in the sandbox', () => {
    const sandbox = { exerciseMode: false, learnerCode: RECT_STARTER };
    expect(screenOutput('```glsl\nfloat d = length(uv - 0.5);\n```', sandbox).ok).toBe(true);
    expect(screenOutput('```\n' + 'x;\n'.repeat(10) + '```', sandbox).ok).toBe(false);
  });

  it('finds the learner\'s variables', () => {
    expect([...learnerVariables(RECT_STARTER)].sort()).toEqual(['bandX', 'bandY', 'rect', 'uv']);
  });
});

describe('numberLines', () => {
  it('numbers and marks lines', () => {
    const code = 'a\nb\nc\nd\ne\nf\ng\nh\nvoid main() {\n  vec2 uv = gl_FragCoord.xy;';
    expect(numberLines(code, 9, 10, 10)).toBe('  9 | void main() {\n>10 |   vec2 uv = gl_FragCoord.xy;');
  });
});

describe('exercise material and prompts', () => {
  it('never opens reference.glsl', () => {
    expect(MATERIAL_FILES).not.toContain('reference.glsl');
  });

  it('reads an exercise once, but never caches unknown ids', async () => {
    const load = createMaterialLoader(LESSONS + '/');
    const a = await load('03-step/03-rectangle');
    expect(await load('03-step/03-rectangle')).toBe(a);
    expect(await load('nope/nope')).toBeNull();
  });

  it('rejects ids that could escape the lessons folder', async () => {
    expect(await loadMaterial('../package.json')).toBeNull();
    expect(await loadMaterial('01-coordinates/../../x')).toBeNull();
    expect(await loadMaterial('nope/nope')).toBeNull();
  });

  it.each(exerciseIds())('%s: prompts carry the notes but none of the solution', async (id) => {
    const m = await loadMaterial(id);
    expect(m).not.toBeNull();
    const dir = `${LESSONS}/${id.replace('/', '/exercises/')}`;
    const starter = readFileSync(`${dir}/starter.glsl`, 'utf8');
    const reference = readFileSync(`${dir}/reference.glsl`, 'utf8');
    const notes = readFileSync(`${dir}/notes.md`, 'utf8').trim();
    const prompt = readFileSync(`${dir}/prompt.md`, 'utf8');
    const norm = (s: string) => s.replace(/\s+/g, '');
    // Solution lines: in the reference, not in the starter, and not given away by the prompt itself.
    const solutionLines = reference
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l.length > 8 && !norm(starter).includes(norm(l)) && !norm(prompt).includes(norm(l)));
    // (Some exercises are fully described by their prompt; those have nothing extra to leak.)

    const reqs: TutorRequest[] = [
      { kind: 'hint', level: 3, context: { code: starter, exerciseId: id } },
      { kind: 'error', error: { line: 3, message: 'x' }, context: { code: starter, exerciseId: id } },
    ];
    for (const req of reqs) {
      const call = buildCall(req, m);
      const all = norm(`${call.system}${call.exercise}${call.user}`);
      expect(call.exercise).toContain(notes.split('\n')[0]);
      for (const line of solutionLines) expect(all).not.toContain(norm(line));
    }
  });

  it('hints include checks, trace values and previous hints', () => {
    const call = buildCall(
      {
        kind: 'hint',
        level: 2,
        previous: ['Look at bandY.'],
        context: {
          code: RECT_STARTER,
          checks: [{ label: 'Above it is black', passed: false, detail: 'got (1, 1, 1)' }],
          trace: { pixel: [200, 320], call: null, line: 12, step: 'rect = 1', vars: [{ name: 'bandY', value: '1' }], output: '(1, 1, 1, 1)' },
        },
      },
      null,
    );
    expect(call.tier).toBe('strong');
    expect(call.user).toContain('✗ Above it is black (got (1, 1, 1))');
    expect(call.user).toContain('pixel (200, 320)');
    expect(call.user).toContain('bandY = 1');
    expect(call.user).toContain('1. Look at bandY.');
    expect(call.user).toContain('hint 2 of 3');
    expect(call.system).toBe(SYSTEM_PROMPT);
  });
});

// ---------------------------------------------------------------------------

class FakeModel implements LanguageModel {
  readonly name = 'fake';
  readonly live = true;
  calls: ModelCall[] = [];
  constructor(private readonly replies: (string | ModelResult)[]) {}
  async generate(call: ModelCall): Promise<ModelResult> {
    this.calls.push(call);
    const r = this.replies.shift() ?? 'ok';
    return typeof r === 'string' ? { text: r, model: 'fake-1' } : r;
  }
}

const hint = (code = RECT_STARTER): TutorRequest => ({
  kind: 'hint',
  level: 1,
  context: { code, exerciseId: '03-step/03-rectangle' },
});

describe('Tutor', () => {
  it('answers and caches identical requests', async () => {
    const model = new FakeModel(['Look at `bandY` on line 11.']);
    const tutor = new Tutor(model, loadMaterial);
    const a = await tutor.complete(hint());
    const b = await tutor.complete(hint());
    expect(a).toMatchObject({ text: 'Look at `bandY` on line 11.', provider: 'fake', model: 'fake-1' });
    expect(b.cached).toBe(true);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].exercise).toContain('Teacher notes');
  });

  it('retries once more strictly when the answer contains code, then accepts a clean one', async () => {
    const model = new FakeModel(['Write `float bandY = step(0.3, uv.y);`', 'Think about where `bandY` should be 1.']);
    const r = await new Tutor(model, loadMaterial).complete(hint());
    expect(r.text).toBe('Think about where `bandY` should be 1.');
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].user).toContain('Answer again with no code');
  });

  it('falls back to a canned nudge when the model keeps writing code', async () => {
    const model = new FakeModel(['`rect = bandX * bandY;`', '```\nrect = bandX * bandY;\n```']);
    const r = await new Tutor(model, loadMaterial).complete(hint());
    expect(r.fallback).toBe(true);
    expect(r.text).toContain('Debugger');
  });

  it('does not screen sandbox answers the same way', async () => {
    const model = new FakeModel(['`float d = length(uv - 0.5);` gives the distance to the center.']);
    const r = await new Tutor(model, loadMaterial).complete({ kind: 'hint', level: 1, context: { code: 'void main() {\n  float d = 1.0;\n}' } });
    expect(r.fallback).toBeUndefined();
  });

  it('handles refusals', async () => {
    const model = new FakeModel([{ text: '', model: 'fake-1', refused: true }]);
    const r = await new Tutor(model, loadMaterial).complete(hint());
    expect(r.fallback).toBe(true);
  });

  it('rejects unknown exercises', async () => {
    const req = hint();
    req.context.exerciseId = '09-nope/01-nope';
    await expect(new Tutor(new FakeModel([]), loadMaterial).complete(req)).rejects.toBeInstanceOf(TutorError);
  });
});

describe('OpenRouterModel', () => {
  type Choice = { finishReason: string | null; message: { content?: unknown; refusal?: string | null } };
  function fakeClient(choice: Choice | null) {
    const send = vi.fn().mockResolvedValue({ model: 'm', choices: choice ? [{ index: 0, ...choice }] : [] });
    return { client: { chat: { send } } as unknown as OpenRouter, send };
  }
  const call: ModelCall = { tier: 'strong', system: 'S', exercise: 'E', user: 'U', maxTokens: 100 };

  it('sends the system prompt and exercise as one system message, without streaming', async () => {
    const { client, send } = fakeClient({ finishReason: 'stop', message: { content: ' Hi ' } });
    const signal = new AbortController().signal;
    const r = await new OpenRouterModel(client).generate(call, signal);
    expect(r).toEqual({ text: 'Hi', model: 'm' });
    const [{ chatRequest }, options] = send.mock.calls[0];
    expect(chatRequest.model).toBe(DEFAULT_MODEL);
    expect(chatRequest.messages).toEqual([
      { role: 'system', content: 'S\n\nE' },
      { role: 'user', content: 'U' },
    ]);
    expect(chatRequest.maxTokens).toBe(100);
    expect(chatRequest.stream).toBe(false);
    expect(chatRequest.reasoning).toEqual({ effort: 'medium', exclude: true });
    expect(options.signal).toBe(signal);
  });

  it('uses the fast model at low effort for one-liners', async () => {
    const { client, send } = fakeClient({ finishReason: 'stop', message: { content: [{ type: 'text', text: 'x' }] } });
    const r = await new OpenRouterModel(client, { fast: 'f', strong: 's' }).generate({ ...call, tier: 'fast', exercise: null });
    expect(r.text).toBe('x');
    const { chatRequest } = send.mock.calls[0][0];
    expect(chatRequest.model).toBe('f');
    expect(chatRequest.reasoning.effort).toBe('low');
    expect(chatRequest.messages[0]).toEqual({ role: 'system', content: 'S' });
  });

  it('reports refusals instead of reading content', async () => {
    expect(await new OpenRouterModel(fakeClient({ finishReason: 'content_filter', message: {} }).client).generate(call)).toMatchObject({ refused: true });
    expect(await new OpenRouterModel(fakeClient({ finishReason: 'stop', message: { content: '', refusal: 'no' } }).client).generate(call)).toMatchObject({ refused: true });
  });

  it('turns an empty answer into a readable error', async () => {
    await expect(new OpenRouterModel(fakeClient({ finishReason: 'length', message: { content: null } }).client).generate(call)).rejects.toThrow(/ran out of room/);
    await expect(new OpenRouterModel(fakeClient(null).client).generate(call)).rejects.toThrow(/empty answer/);
  });

  it('maps SDK errors to messages a learner can act on', () => {
    expect(toTutorError(new orErrors.RequestAbortedError('aborted')).status).toBe(499);
    expect(toTutorError(new orErrors.ConnectionError('offline')).message).toMatch(/internet/);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toTutorError(new Error('boom')).status).toBe(502);
    log.mockRestore();
  });
});

describe('parseTutorRequest', () => {
  it('accepts a valid hint and trims context', () => {
    const r = parseTutorRequest({ kind: 'hint', level: 2, previous: ['a'], context: { code: 'x', bogus: 1 } });
    expect(r).toEqual({ kind: 'hint', level: 2, previous: ['a'], context: { code: 'x', cursorLine: undefined, exerciseId: undefined } });
  });
  it('rejects bad input with a message', () => {
    expect(parseTutorRequest(null)).toMatch(/object/);
    expect(parseTutorRequest({ kind: 'hint', level: 4, context: { code: '' } })).toMatch(/level/);
    expect(parseTutorRequest({ kind: 'line', line: 1, context: { code: '' } })).toMatch(/kind/);
    expect(parseTutorRequest({ kind: 'hint', level: 1, context: {} })).toMatch(/code/);
    expect(parseTutorRequest({ kind: 'chat', context: { code: '' } })).toMatch(/kind/);
  });
});
