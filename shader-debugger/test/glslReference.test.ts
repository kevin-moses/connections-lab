import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTINS, UNSUPPORTED_BUILTINS } from '../src/interp/builtins';
import { GLSL_REFERENCE, builtinsUsedIn, lookupGlsl } from '../shared/glslReference';
import { buildCall } from '../server/tutor/prompts';

describe('GLSL reference', () => {
  it('documents every built-in the Debugger can run', () => {
    const missing = Object.keys(BUILTINS).filter((name) => !lookupGlsl(name));
    expect(missing).toEqual([]);
  });

  it('marks exactly the built-ins the Debugger cannot run', () => {
    for (const e of GLSL_REFERENCE.filter((e) => e.kind === 'function')) {
      expect(e.debuggable === false, e.name).toBe(UNSUPPORTED_BUILTINS.has(e.name));
    }
  });

  it('has no duplicate names, and every entry has a signature and a one-liner', () => {
    expect(new Set(GLSL_REFERENCE.map((e) => e.name)).size).toBe(GLSL_REFERENCE.length);
    for (const e of GLSL_REFERENCE) {
      expect(e.signatures.length, e.name).toBeGreaterThan(0);
      expect(e.oneLiner.length, e.name).toBeGreaterThan(5);
    }
  });

  it('finds the built-ins a shader calls, ignoring comments and its own names', () => {
    const code = '// mix(a, b)\nfloat rect(vec2 p) { return step(0.2, p.x) * step(p.y, 0.8); }\nvoid main() { float d = length(uv); rect(uv); }';
    expect(builtinsUsedIn(code).map((e) => e.name)).toEqual(['step', 'length']);
  });

  it('grounds tutor prompts in the reference', () => {
    const call = buildCall({ kind: 'hint', level: 2, context: { code: 'void main() { float a = smoothstep(0.4, 0.5, d); }' } }, null);
    expect(call.user).toContain('smoothstep(genType edge0, genType edge1, genType x)');
  });

  it("examples don't give away any exercise's solution", () => {
    const norm = (c: string) => c.replace(/\/\/.*$/gm, '').replace(/\s+/g, '');
    const exercises: { reference: string; starter: string }[] = [];
    for (const lesson of readdirSync('lessons')) {
      for (const ex of readdirSync(`lessons/${lesson}/exercises`)) {
        const read = (f: string) => norm(readFileSync(`lessons/${lesson}/exercises/${ex}/${f}`, 'utf8'));
        exercises.push({ reference: read('reference.glsl'), starter: read('starter.glsl') });
      }
    }
    for (const e of GLSL_REFERENCE) {
      if (!e.example) continue;
      // The example's right-hand side (or the whole statement) must not be part of a solution
      // the starter doesn't already show (e.g. atan(p.y, p.x) is given in the polar starters).
      const rhs = norm(e.example.split('=').slice(1).join('=') || e.example).replace(/;$/, '');
      const gives = exercises.some((x) => x.reference.includes(rhs) && !x.starter.includes(rhs));
      expect(gives, `${e.name}: ${e.example}`).toBe(false);
    }
  });
});
