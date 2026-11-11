import { describe, expect, it } from 'vitest';
import { BUILTINS, callBuiltin } from '../src/interp/builtins';
import { binary } from '../src/interp/ops';
import { bool, construct, float, int, make, type, vec, type Value } from '../src/interp/values';

const f = Math.fround;
const mat = (cols: number, rows: number, ...data: number[]) => make(type('float', rows, cols), data);
const ivec = (...xs: number[]) => make(type('int', xs.length), xs);
const bvec = (...xs: boolean[]) => make(type('bool', xs.length), xs.map(Number));

function call(name: string, ...args: Value[]) {
  return callBuiltin(name, args);
}

function close(actual: Value, expected: number[], eps = 1e-6) {
  expect(actual.data.length).toBe(expected.length);
  actual.data.forEach((x, i) => expect(x).toBeCloseTo(expected[i], -Math.log10(eps)));
}

describe('built-ins', () => {
  const cases: [string, Value[], number[]][] = [
    ['radians', [float(180)], [Math.PI]],
    ['degrees', [float(Math.PI)], [180]],
    ['sin', [vec(0, Math.PI / 2)], [0, 1]],
    ['cos', [float(0)], [1]],
    ['tan', [float(Math.PI / 4)], [1]],
    ['asin', [float(1)], [Math.PI / 2]],
    ['acos', [float(1)], [0]],
    ['atan', [float(1)], [Math.PI / 4]],
    ['atan', [float(1), float(-1)], [(3 * Math.PI) / 4]],
    ['sinh', [float(0)], [0]],
    ['cosh', [float(0)], [1]],
    ['tanh', [float(0)], [0]],
    ['asinh', [float(0)], [0]],
    ['acosh', [float(1)], [0]],
    ['atanh', [float(0)], [0]],
    ['pow', [vec(2, 3), float(2)], [4, 9]],
    ['exp', [float(1)], [Math.E]],
    ['log', [float(Math.E)], [1]],
    ['exp2', [float(3)], [8]],
    ['log2', [float(8)], [3]],
    ['sqrt', [vec(4, 9)], [2, 3]],
    ['inversesqrt', [float(4)], [0.5]],
    ['abs', [vec(-1, 2)], [1, 2]],
    ['abs', [int(-3)], [3]],
    ['sign', [vec(-2, 0, 5)], [-1, 0, 1]],
    ['floor', [vec(1.7, -1.2)], [1, -2]],
    ['ceil', [vec(1.2, -1.7)], [2, -1]],
    ['trunc', [vec(1.7, -1.7)], [1, -1]],
    ['round', [vec(1.5, -1.5, 0.4)], [2, -2, 0]],
    ['roundEven', [vec(1.5, 2.5, -2.5)], [2, 2, -2]],
    ['fract', [vec(1.25, -0.25)], [0.25, 0.75]],
    ['mod', [vec(5.5, -1), float(2)], [1.5, 1]],
    ['min', [vec(1, 5), float(3)], [1, 3]],
    ['max', [vec(1, 5), vec(2, 4)], [2, 5]],
    ['clamp', [vec(-1, 0.5, 2), float(0), float(1)], [0, 0.5, 1]],
    ['mix', [float(0), float(10), float(0.25)], [2.5]],
    ['mix', [vec(0, 0), vec(10, 20), vec(0.5, 0.25)], [5, 5]],
    ['mix', [vec(1, 2), vec(3, 4), bvec(false, true)], [1, 4]],
    ['step', [float(0.5), vec(0.4, 0.5, 0.6)], [0, 1, 1]],
    ['step', [vec(0.2, 0.8), vec(0.5, 0.5)], [1, 0]],
    ['smoothstep', [float(0), float(1), vec(-1, 0.5, 2)], [0, 0.5, 1]],
    ['smoothstep', [float(0), float(1), float(0.25)], [0.15625]],
    ['length', [vec(3, 4)], [5]],
    ['distance', [vec(1, 1), vec(4, 5)], [5]],
    ['dot', [vec(1, 2, 3), vec(4, 5, 6)], [32]],
    ['cross', [vec(1, 0, 0), vec(0, 1, 0)], [0, 0, 1]],
    ['normalize', [vec(3, 4)], [0.6, 0.8]],
    ['faceforward', [vec(0, 1), vec(0, -1), vec(0, 1)], [0, 1]],
    ['faceforward', [vec(0, 1), vec(0, 1), vec(0, 1)], [0, -1]],
    ['reflect', [vec(1, -1), vec(0, 1)], [1, 1]],
    ['refract', [vec(0, -1), vec(0, 1), float(1)], [0, -1]],
    ['lessThan', [vec(1, 3), vec(2, 2)], [1, 0]],
    ['lessThanEqual', [vec(2, 3), vec(2, 2)], [1, 0]],
    ['greaterThan', [vec(1, 3), vec(2, 2)], [0, 1]],
    ['greaterThanEqual', [vec(2, 1), vec(2, 2)], [1, 0]],
    ['equal', [ivec(1, 2), ivec(1, 3)], [1, 0]],
    ['notEqual', [ivec(1, 2), ivec(1, 3)], [0, 1]],
    ['any', [bvec(false, true)], [1]],
    ['all', [bvec(false, true)], [0]],
    ['not', [bvec(false, true)], [1, 0]],
    ['isnan', [vec(NaN, 1)], [1, 0]],
    ['isinf', [vec(Infinity, 1)], [1, 0]],
    ['matrixCompMult', [mat(2, 2, 1, 2, 3, 4), mat(2, 2, 2, 2, 2, 2)], [2, 4, 6, 8]],
    ['outerProduct', [vec(1, 2), vec(3, 4)], [3, 6, 4, 8]],
    ['transpose', [mat(2, 2, 1, 2, 3, 4)], [1, 3, 2, 4]],
    ['determinant', [mat(2, 2, 1, 2, 3, 4)], [-2]],
    ['determinant', [mat(3, 3, 2, 0, 0, 0, 3, 0, 0, 0, 4)], [24]],
    ['inverse', [mat(2, 2, 4, 0, 0, 2)], [0.25, 0, 0, 0.5]],
  ];

  it.each(cases)('%s(%j)', (name, args, expected) => {
    close(call(name, ...args), expected, 1e-5);
  });

  it('covers every implemented built-in', () => {
    const tested = new Set(cases.map((c) => c[0]));
    expect(Object.keys(BUILTINS).filter((n) => !tested.has(n))).toEqual([]);
  });

  it('inverse works for 3x3 and 4x4 (M · M⁻¹ = I)', () => {
    const m3 = mat(3, 3, 2, 1, 0, 1, 3, 1, 0, 1, 4);
    const m4 = mat(4, 4, 4, 1, 0, 2, 1, 3, 1, 0, 0, 1, 5, 1, 2, 0, 1, 6);
    for (const [m, n] of [[m3, 3], [m4, 4]] as const) {
      const id = binary('*', m, call('inverse', m));
      const expected = Array.from({ length: n * n }, (_, i) => (i % (n + 1) === 0 ? 1 : 0));
      close(id, expected, 1e-4);
    }
  });

  it('rounds float results to float32', () => {
    expect(call('sin', float(1)).data[0]).toBe(f(Math.sin(f(1))));
  });

  it('reports unsupported built-ins clearly', () => {
    expect(() => call('texture', float(0))).toThrow(/textures/);
    expect(() => call('fwidth', float(0))).toThrow(/neighbouring pixels/);
  });
});

describe('operators and constructors', () => {
  it('mat * vec and vec * mat follow GLSL column-major rules', () => {
    const m = mat(2, 2, 1, 2, 3, 4); // columns (1,2) and (3,4)
    close(binary('*', m, vec(1, 1)), [4, 6]);
    close(binary('*', vec(1, 1), m), [3, 7]);
    close(binary('*', m, m), [7, 10, 15, 22]);
  });

  it('broadcasts scalars and divides ints by truncation', () => {
    close(binary('*', vec(1, 2, 3), float(2)), [2, 4, 6]);
    close(binary('-', float(1), vec(0.25, 0.5)), [0.75, 0.5]);
    expect(binary('/', int(-7), int(2)).data[0]).toBe(-3);
    expect(binary('%', int(7), int(3)).data[0]).toBe(1);
  });

  it('compares whole values with == and scalars with <', () => {
    expect(binary('==', vec(1, 2), vec(1, 2)).data[0]).toBe(1);
    expect(binary('!=', vec(1, 2), vec(1, 3)).data[0]).toBe(1);
    expect(binary('<', float(1), float(2)).data[0]).toBe(1);
  });

  it('constructs vectors, matrices and conversions', () => {
    expect(construct(type('float', 3), [float(0.5)]).data).toEqual([0.5, 0.5, 0.5]);
    expect(construct(type('float', 4), [vec(1, 2), float(3), float(4)]).data).toEqual([1, 2, 3, 4]);
    expect(construct(type('float', 2), [vec(1, 2, 3)]).data).toEqual([1, 2]);
    expect(construct(type('float', 2, 2), [float(2)]).data).toEqual([2, 0, 0, 2]);
    expect(construct(type('float', 3, 3), [mat(2, 2, 1, 2, 3, 4)]).data).toEqual([1, 2, 0, 3, 4, 0, 0, 0, 1]);
    expect(construct(type('int'), [float(-2.7)]).data).toEqual([-2]);
    expect(construct(type('float'), [bool(true)]).data).toEqual([1]);
    expect(construct(type('bool', 2), [vec(0, 3)]).data).toEqual([0, 1]);
  });
});
