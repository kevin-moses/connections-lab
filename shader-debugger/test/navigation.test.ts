import { describe, expect, it } from 'vitest';
import { parseGlsl } from '../src/glsl/parse';
import { traceFragment } from '../src/interp/interpreter';
import { alignStep, divergentLines, inlineValues, runToLine, stepBackOver, stepOut, stepOver } from '../src/debugger/navigation';

const SRC = `precision highp float;
uniform vec2 u_resolution;
out vec4 fragColor;
float sq(float x) {
  return x * x;
}
void main() {
  float a = gl_FragCoord.x / u_resolution.x;
  float b = sq(a);
  if (a > 0.5) b = 1.0;
  for (int i = 0; i < 2; i++) {
    b += 0.1;
  }
  fragColor = vec4(b);
}`;

function trace(x: number) {
  const p = parseGlsl(SRC);
  if (!p.ok) throw new Error(p.diagnostic.message);
  return traceFragment(p.ast, { pixel: [x, 0], uniforms: { u_resolution: [100, 100] } }).steps;
}

const A = trace(20); // a ≈ 0.2: branch not taken
const B = trace(80); // a ≈ 0.8: branch taken

describe('stepper navigation', () => {
  it('steps over and out of calls', () => {
    const call = A.findIndex((s) => s.kind === 'call');
    expect(A[call].depth).toBe(1);
    expect(A[stepOver(A, call - 1)].line).toBe(9); // from line 8, over sq() to line 9
    expect(A[stepOut(A, call)].line).toBe(9);
    expect(stepBackOver(A, call + 2)).toBe(call - 1);
  });

  it('runs to a line, wrapping around', () => {
    const first12 = runToLine(A, 0, 12)!;
    expect(A[first12].line).toBe(12);
    const second12 = runToLine(A, first12, 12)!;
    expect(second12).toBeGreaterThan(first12);
    expect(runToLine(A, second12, 12)).toBe(first12);
    expect(runToLine(A, 0, 99)).toBeNull();
  });

  it('shows the latest value per line, with loop passes', () => {
    const end = A.length - 1;
    const v = new Map(inlineValues(A, end).map((x) => [x.line, x.text]));
    expect(v.get(8)).toMatch(/^a = 0\.205/);
    expect(v.get(12)).toMatch(/pass 2$/);
    expect(v.has(15)).toBe(true); // closing brace: end step
    // nothing from the future
    expect(inlineValues(A, 0).map((x) => x.line)).toEqual([8]);
  });

  it('aligns steps between two pixels by line and occurrence', () => {
    const secondLoopBody = A.findIndex((s, i) => s.line === 12 && A.slice(0, i).some((p) => p.line === 12));
    const j = alignStep(A, secondLoopBody, B)!;
    expect(B[j].line).toBe(12);
    expect(B[j].loopIter).toBe(2);
  });

  it('flags lines that ran differently', () => {
    expect(divergentLines(A, B)).toEqual([10]);
    expect(divergentLines(A, trace(21))).toEqual([]);
  });
});
