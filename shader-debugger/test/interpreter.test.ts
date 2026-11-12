import { describe, expect, it } from 'vitest';
import { parseGlsl } from '../src/glsl/parse';
import { traceCall, traceFragment, type TraceInputs } from '../src/interp/interpreter';
import { DEFAULT_SHADER } from '../src/defaultShader';

const f = Math.fround;

function run(body: string, inputs: Partial<TraceInputs> = {}, header = 'precision highp float;\nuniform vec2 u_resolution;\nuniform float u_time;\nuniform vec2 u_mouse;\nout vec4 fragColor;\n') {
  const src = header + body;
  const parsed = parseGlsl(src);
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  return traceFragment(parsed.ast, {
    pixel: inputs.pixel ?? [100, 50],
    uniforms: inputs.uniforms ?? { u_resolution: [400, 200], u_time: 1.5, u_mouse: [0, 0] },
  });
}

const out = (r: ReturnType<typeof run>) => {
  if (r.error) throw new Error(`${r.error.message} (line ${r.error.line})`);
  return r.output!.value.data;
};

describe('traceFragment: results', () => {
  it('computes uv from gl_FragCoord and u_resolution', () => {
    const r = run('void main() { vec2 uv = gl_FragCoord.xy / u_resolution; fragColor = vec4(uv, 0.0, 1.0); }');
    expect(out(r)).toEqual([f(100.5 / 400), f(50.5 / 200), 0, 1]);
  });

  it('matches a hand computation of the default example shader', () => {
    const parsed = parseGlsl(DEFAULT_SHADER);
    if (!parsed.ok) throw new Error('parse');
    const res = [400, 300];
    const px = [120, 80];
    const t = 2.0;
    const mouse = [200, 150];
    const r = traceFragment(parsed.ast, { pixel: px as [number, number], uniforms: { u_resolution: res, u_time: t, u_mouse: mouse } });
    const fc = [px[0] + 0.5, px[1] + 0.5];
    const uv = [fc[0] / res[0], fc[1] / res[1]];
    const col = [uv[0], uv[1], uv[0]].map((u, i) => 0.5 + 0.5 * Math.cos(t + u + [0, 2, 4][i]));
    const d = Math.hypot(fc[0] - mouse[0], fc[1] - mouse[1]) / res[1];
    const s = Math.min(Math.max(d / 0.25, 0), 1);
    const k = s * s * (3 - 2 * s);
    const expected = [...col.map((c) => c * k), 1];
    out(r).forEach((x, i) => expect(x).toBeCloseTo(expected[i], 5));
  });

  it('handles if/else, ternary and short-circuit logic', () => {
    const r = run(`void main() {
      float a = 0.0;
      if (gl_FragCoord.x > 50.0) a = 1.0; else { a = 2.0; }
      float b = a > 0.5 ? 3.0 : 4.0;
      bool c = false && (1.0 / 0.0 > 0.0);
      fragColor = vec4(a, b, float(c), 1.0);
    }`);
    expect(out(r)).toEqual([1, 3, 0, 1]);
  });

  it('runs for/while/do loops with break and continue', () => {
    const r = run(`void main() {
      float s = 0.0;
      for (int i = 0; i < 10; i++) { if (i == 2) continue; if (i == 5) break; s += float(i); }
      int j = 0; while (j < 3) { j++; }
      int k = 0; do { k += 2; } while (k < 5);
      fragColor = vec4(s, float(j), float(k), 1.0);
    }`);
    expect(out(r)).toEqual([0 + 1 + 3 + 4, 3, 6, 1]);
  });

  it('calls user functions with in, out and inout parameters', () => {
    const r = run(`
      float twice(float x) { return x * 2.0; }
      void split(vec2 v, out float a, inout float b) { a = v.x; b += v.y; }
      void main() {
        float a; float b = 10.0;
        split(vec2(1.0, 2.0), a, b);
        fragColor = vec4(twice(a), b, 0.0, 1.0);
      }`);
    expect(out(r)).toEqual([2, 12, 0, 1]);
  });

  it('picks the right overload', () => {
    const r = run(`
      float pick(float x) { return 1.0; }
      float pick(vec2 x) { return 2.0; }
      void main() { fragColor = vec4(pick(0.0), pick(vec2(0.0)), 0.0, 1.0); }`);
    expect(out(r)).toEqual([1, 2, 0, 1]);
  });

  it('assigns through swizzles, indexes and compound operators', () => {
    const r = run(`void main() {
      vec3 c = vec3(1.0, 2.0, 3.0);
      c.zx = vec2(9.0, 8.0);
      c.y *= 2.0;
      c[1] += 1.0;
      float arr[3] = float[3](1.0, 2.0, 3.0);
      arr[2] = arr[0] + arr[1];
      int n = 1; n++; ++n; int m = n--;
      fragColor = vec4(c.x, c.y, c.z + arr[2], float(m * 10 + n));
    }`);
    expect(out(r)).toEqual([8, 5, 12, 32]);
  });

  it('does matrix math', () => {
    const r = run(`void main() {
      float a = 0.5;
      mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
      vec2 p = rot * vec2(1.0, 0.0);
      mat3 m = mat3(2.0);
      fragColor = vec4(p, m[1][1], determinant(m));
    }`);
    const [x, y, m11, det] = out(r);
    expect(x).toBeCloseTo(Math.cos(0.5), 6);
    expect(y).toBeCloseTo(Math.sin(0.5), 6);
    expect([m11, det]).toEqual([2, 8]);
  });

  it('does integer math like the GPU', () => {
    const r = run(`void main() {
      int a = -7 / 2;
      int b = 7 % 3;
      uint c = 3u * 2u;
      int d = 0x10 + 010;
      fragColor = vec4(float(a), float(b), float(c), float(d));
    }`);
    expect(out(r)).toEqual([-3, 1, 6, 24]);
  });

  it('supports #define constants and globals with initializers', () => {
    const r = run(`#define PI 3.14159265\nconst float HALF = 0.5;\nfloat g = HALF * 2.0;\nvoid main() { fragColor = vec4(sin(PI * HALF), g, 0.0, 1.0); }`);
    const [s, g] = out(r);
    expect(s).toBeCloseTo(1, 6);
    expect(g).toBe(1);
  });

  it('reports discard', () => {
    const r = run('void main() { if (gl_FragCoord.x > 0.0) discard; fragColor = vec4(1.0); }');
    expect(r.discarded).toBe(true);
    expect(r.output).toBeNull();
    expect(r.steps.at(-1)?.kind).toBe('discard');
  });

  it('supports ES 1.00 style gl_FragColor', () => {
    const r = run('void main() { gl_FragColor = vec4(0.25); }', {}, 'precision mediump float;\n');
    expect(r.output?.name).toBe('gl_FragColor');
    expect(out(r)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('treats unset uniforms as 0', () => {
    const r = run('uniform float u_speed;\nvoid main() { fragColor = vec4(u_speed); }');
    expect(out(r)).toEqual([0, 0, 0, 0]);
  });
});

describe('traceFragment: trace', () => {
  const SRC = `float sq(float x) {
  return x * x;
}
void main() {
  float a = 2.0;
  float b = sq(a);
  for (int i = 0; i < 2; i++) {
    b += 1.0;
  }
  fragColor = vec4(b);
}`;
  // header is 5 lines, so SRC line n is file line n + 5
  const L = (n: number) => n + 5;

  it('records statements, calls, returns and loop steps in order', () => {
    const r = run(SRC);
    const steps = r.steps.map((s) => [s.kind, s.line, s.depth, s.text]);
    expect(steps).toEqual([
      ['statement', L(5), 0, 'a = 2'],
      ['call', L(1), 1, 'sq(x = 2)'],
      ['return', L(2), 1, 'return 4'],
      ['statement', L(6), 0, 'b = 4'],
      ['statement', L(7), 0, 'i = 0'],
      ['loop', L(7), 0, 'i < 2 → true · pass 1'],
      ['statement', L(8), 0, 'b = 5'],
      ['loop', L(7), 0, 'i = 1'],
      ['loop', L(7), 0, 'i < 2 → true · pass 2'],
      ['statement', L(8), 0, 'b = 6'],
      ['loop', L(7), 0, 'i = 2'],
      ['loop', L(7), 0, 'i < 2 → false · loop ends'],
      ['statement', L(10), 0, 'fragColor = (6, 6, 6, 6)'],
      ['end', L(11), 0, 'fragColor = (6, 6, 6, 6)'],
    ]);
  });

  it('snapshots locals, changed vars, stack and loop pass per step', () => {
    const r = run(SRC);
    const inCall = r.steps[1];
    expect(inCall.fn).toBe('sq');
    expect(inCall.stack.map((s) => s.fn)).toEqual(['main', 'sq']);
    expect(inCall.locals.map((v) => v.name)).toEqual(['x']);

    const bodyPass2 = r.steps[9];
    expect(bodyPass2.loopIter).toBe(2);
    expect(bodyPass2.changed).toEqual(['b']);
    expect(bodyPass2.locals.map((v) => v.name)).toEqual(['a', 'b', 'i']);

    const afterLoop = r.steps[12];
    expect(afterLoop.locals.map((v) => v.name)).toEqual(['a', 'b']); // i went out of scope
    expect(afterLoop.globals.map((v) => v.name)).toEqual(['fragColor']);
  });

  it('records built-in calls with inputs and output', () => {
    const r = run('void main() { float d = length(vec2(3.0, 4.0)); fragColor = vec4(d); }');
    expect(r.steps[0].builtins).toEqual([{ name: 'length', args: ['(3, 4)'], result: '5' }]);
  });

  it('exposes uniforms and gl_FragCoord as inputs', () => {
    const r = run('void main() { fragColor = vec4(1.0); }');
    expect(r.inputs.map((v) => v.name)).toEqual(expect.arrayContaining(['gl_FragCoord', 'u_resolution', 'u_time', 'u_mouse']));
  });

  it('stops runaway loops and reports the line', () => {
    const r = run('void main() {\n  float x = 0.0;\n  for (int i = 0; i >= 0; i++) { x += 1.0; }\n  fragColor = vec4(x);\n}');
    expect(r.error?.message).toMatch(/more than 1,000 times/);
    expect(r.error?.line).toBe(8);
  });

  it('explains unsupported features with a line number', () => {
    const r = run('uniform sampler2D tex;\nvoid main() {\n  fragColor = texture(tex, vec2(0.5));\n}');
    expect(r.error?.message).toMatch(/texture\(\) yet/);
    expect(r.error?.line).toBe(8);
  });
});

describe('traceCall', () => {
  const SRC = `precision highp float;
uniform float u_time;
out vec4 fragColor;
float rect(vec2 uv, vec2 lo, vec2 hi) {
  vec2 s = step(lo, uv) * (1.0 - step(hi, uv));
  return s.x * s.y;
}
void main() { fragColor = vec4(rect(gl_FragCoord.xy, vec2(0.0), vec2(1.0))); }`;
  const ast = () => {
    const p = parseGlsl(SRC);
    if (!p.ok) throw new Error(p.diagnostic.message);
    return p.ast;
  };

  it('evaluates a call to a learner function and records its steps', () => {
    const r = traceCall(ast(), 'rect(vec2(0.5), vec2(0.2), vec2(0.8))', { pixel: [0, 0], uniforms: {} });
    expect(r.error).toBeNull();
    expect(r.output?.value.data).toEqual([1]);
    expect(r.steps.map((s) => s.kind)).toEqual(['call', 'statement', 'return', 'end']);
    expect(r.steps[0].depth).toBe(1);
    expect(r.steps.at(-1)?.text).toBe('rect(vec2(0.5), vec2(0.2), vec2(0.8)) = 1');
  });

  it('reports unknown functions and bad expressions', () => {
    expect(traceCall(ast(), 'circle(vec2(0.0), 1.0)', { pixel: [0, 0], uniforms: {} }).error?.message).toMatch(/Unknown function circle/);
    expect(traceCall(ast(), 'rect(', { pixel: [0, 0], uniforms: {} }).error?.message).toMatch(/Can't parse/);
  });

  it('evaluates a final expression in main()\'s scope', () => {
    const p = parseGlsl('precision highp float;\nout vec4 fragColor;\nvoid main() { vec3 a = vec3(0.0); vec3 b = vec3(1.0, 2.0, 3.0); fragColor = vec4(a, 1.0); }');
    if (!p.ok) throw new Error('parse');
    const r = traceFragment(p.ast, { pixel: [0, 0], uniforms: {} }, { finalExpression: 'mix(a, b, 0.25).g' });
    expect((r.finalValue as { data: number[] }).data).toEqual([0.5]);
    const bad = traceFragment(p.ast, { pixel: [0, 0], uniforms: {} }, { finalExpression: 'nope' });
    expect(bad.finalError).toMatch(/Unknown variable nope/);
  });

  it('can skip recording for speed but still enforce the step cap', () => {
    const r = traceFragment(ast(), { pixel: [0, 0], uniforms: {} }, { record: false });
    expect(r.steps).toEqual([]);
    expect(r.output?.value.data).toEqual([1, 1, 1, 1]);
    const capped = traceFragment(ast(), { pixel: [0, 0], uniforms: {} }, { record: false, maxSteps: 1 });
    expect(capped.truncated).toBe(true);
  });
});
