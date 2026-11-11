import { map, matMul, zip, zip3 } from './ops';
import {
  GlslRuntimeError,
  isMatrix,
  isScalar,
  make,
  sizeOf,
  type,
  typeName,
  BOOL,
  FLOAT,
  type Value,
} from './values';

type Builtin = (args: Value[]) => Value;

const unaryF = (f: (x: number) => number): Builtin => ([x]) => map(x, f, 'float');
const binaryF = (f: (x: number, y: number) => number): Builtin => ([x, y]) => zip(x, y, f);

const clampN = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

function dot(a: Value, b: Value): number {
  let s = 0;
  for (let i = 0; i < a.data.length; i++) s += a.data[i] * b.data[i];
  return Math.fround(s);
}

const length = (v: Value) => Math.fround(Math.sqrt(dot(v, v)));

function scale(v: Value, k: number): Value {
  return make(v.type, v.data.map((x) => x * k));
}

function sub(a: Value, b: Value): Value {
  return make(a.type, a.data.map((x, i) => x - b.data[i]));
}

function compare(f: (x: number, y: number) => boolean): Builtin {
  return ([a, b]) => make(type('bool', a.type.rows), a.data.map((x, i) => (f(x, b.data[i]) ? 1 : 0)));
}

function transpose(m: Value): Value {
  const { rows, cols } = m.type;
  const data: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data.push(m.data[c * rows + r]);
  return make(type('float', cols, rows), data);
}

/** Determinant of a square matrix (column-major data). */
function determinant(m: Value): number {
  const n = m.type.rows;
  const a = (c: number, r: number) => m.data[c * n + r];
  if (n === 2) return a(0, 0) * a(1, 1) - a(1, 0) * a(0, 1);
  if (n === 3) {
    return (
      a(0, 0) * (a(1, 1) * a(2, 2) - a(2, 1) * a(1, 2)) -
      a(1, 0) * (a(0, 1) * a(2, 2) - a(2, 1) * a(0, 2)) +
      a(2, 0) * (a(0, 1) * a(1, 2) - a(1, 1) * a(0, 2))
    );
  }
  // 4x4: Laplace expansion along the first column
  let det = 0;
  for (let r = 0; r < 4; r++) {
    det += (r % 2 ? -1 : 1) * a(0, r) * determinant(minor(m, 0, r));
  }
  return det;
}

function minor(m: Value, col: number, row: number): Value {
  const n = m.type.rows;
  const data: number[] = [];
  for (let c = 0; c < n; c++) {
    if (c === col) continue;
    for (let r = 0; r < n; r++) if (r !== row) data.push(m.data[c * n + r]);
  }
  return { type: type('float', n - 1, n - 1), data };
}

function inverse(m: Value): Value {
  const n = m.type.rows;
  const det = determinant(m);
  const data: number[] = new Array(n * n);
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) {
      // inverse[c][r] = cofactor(r, c) / det  (adjugate = transposed cofactors)
      const cof = n === 1 ? 1 : ((r + c) % 2 ? -1 : 1) * (n === 2 ? m.data[(1 - r) * n + (1 - c)] : determinant(minor(m, r, c)));
      data[c * n + r] = cof / det;
    }
  }
  return make(m.type, data);
}

export const BUILTINS: Record<string, Builtin> = {
  // angle & trigonometry
  radians: unaryF((x) => (x * Math.PI) / 180),
  degrees: unaryF((x) => (x * 180) / Math.PI),
  sin: unaryF(Math.sin),
  cos: unaryF(Math.cos),
  tan: unaryF(Math.tan),
  asin: unaryF(Math.asin),
  acos: unaryF(Math.acos),
  atan: (args) => (args.length === 2 ? zip(args[0], args[1], Math.atan2) : map(args[0], Math.atan, 'float')),
  sinh: unaryF(Math.sinh),
  cosh: unaryF(Math.cosh),
  tanh: unaryF(Math.tanh),
  asinh: unaryF(Math.asinh),
  acosh: unaryF(Math.acosh),
  atanh: unaryF(Math.atanh),

  // exponential
  pow: binaryF(Math.pow),
  exp: unaryF(Math.exp),
  log: unaryF(Math.log),
  exp2: unaryF((x) => Math.pow(2, x)),
  log2: unaryF(Math.log2),
  sqrt: unaryF(Math.sqrt),
  inversesqrt: unaryF((x) => 1 / Math.sqrt(x)),

  // common
  abs: ([x]) => map(x, Math.abs),
  sign: ([x]) => map(x, Math.sign),
  floor: unaryF(Math.floor),
  ceil: unaryF(Math.ceil),
  trunc: unaryF(Math.trunc),
  round: unaryF((x) => Math.sign(x) * Math.round(Math.abs(x))),
  roundEven: unaryF((x) => {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  }),
  fract: unaryF((x) => x - Math.floor(x)),
  mod: binaryF((x, y) => x - y * Math.floor(x / y)),
  min: ([a, b]) => zip(a, b, Math.min),
  max: ([a, b]) => zip(a, b, Math.max),
  clamp: ([x, lo, hi]) => zip3(x, lo, hi, clampN),
  mix: ([x, y, a]) => {
    if (a.type.base === 'bool') return zip3(x, y, a, (p, q, s) => (s ? q : p));
    return zip3(x, y, a, (p, q, t) => p * (1 - t) + q * t);
  },
  step: ([edge, x]) => zip(edge, x, (e, v) => (v < e ? 0 : 1), 'float'),
  smoothstep: ([e0, e1, x]) => {
    const r = zip3(x, e0, e1, (v, a, b) => {
      const t = clampN((v - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    });
    return make(type('float', r.type.rows, r.type.cols), r.data);
  },
  isnan: ([x]) => map(x, (v) => (Number.isNaN(v) ? 1 : 0), 'bool'),
  isinf: ([x]) => map(x, (v) => (!Number.isFinite(v) && !Number.isNaN(v) ? 1 : 0), 'bool'),

  // geometric
  length: ([x]) => make(FLOAT, [length(x)]),
  distance: ([a, b]) => make(FLOAT, [length(sub(a, b))]),
  dot: ([a, b]) => make(FLOAT, [dot(a, b)]),
  cross: ([a, b]) => {
    const [ax, ay, az] = a.data;
    const [bx, by, bz] = b.data;
    return make(type('float', 3), [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]);
  },
  normalize: ([x]) => scale(x, 1 / length(x)),
  faceforward: ([n, i, nref]) => (dot(nref, i) < 0 ? n : scale(n, -1)),
  reflect: ([i, n]) => sub(i, scale(n, 2 * dot(n, i))),
  refract: ([i, n, etaV]) => {
    const eta = etaV.data[0];
    const d = dot(n, i);
    const k = 1 - eta * eta * (1 - d * d);
    if (k < 0) return make(i.type, new Array(sizeOf(i.type)).fill(0));
    return sub(scale(i, eta), scale(n, eta * d + Math.sqrt(k)));
  },

  // matrix
  matrixCompMult: ([a, b]) => zip(a, b, (x, y) => x * y),
  outerProduct: ([c, r]) => {
    const data: number[] = [];
    for (let j = 0; j < r.data.length; j++) for (let i = 0; i < c.data.length; i++) data.push(c.data[i] * r.data[j]);
    return make(type('float', c.data.length, r.data.length), data);
  },
  transpose: ([m]) => transpose(m),
  determinant: ([m]) => make(FLOAT, [determinant(m)]),
  inverse: ([m]) => inverse(m),

  // vector relational
  lessThan: compare((x, y) => x < y),
  lessThanEqual: compare((x, y) => x <= y),
  greaterThan: compare((x, y) => x > y),
  greaterThanEqual: compare((x, y) => x >= y),
  equal: compare((x, y) => x === y),
  notEqual: compare((x, y) => x !== y),
  any: ([x]) => make(BOOL, [x.data.some((v) => v !== 0) ? 1 : 0]),
  all: ([x]) => make(BOOL, [x.data.every((v) => v !== 0) ? 1 : 0]),
  not: ([x]) => map(x, (v) => (v ? 0 : 1), 'bool'),
};

/** Known GLSL built-ins the stepper can't run yet (shown as a clear message). */
export const UNSUPPORTED_BUILTINS = new Set([
  'texture',
  'textureProj',
  'textureLod',
  'textureOffset',
  'texelFetch',
  'textureSize',
  'textureGrad',
  'texture2D',
  'textureCube',
  'dFdx',
  'dFdy',
  'fwidth',
  'modf',
  'floatBitsToInt',
  'floatBitsToUint',
  'intBitsToFloat',
  'uintBitsToFloat',
  'packSnorm2x16',
  'unpackSnorm2x16',
  'packUnorm2x16',
  'unpackUnorm2x16',
  'packHalf2x16',
  'unpackHalf2x16',
]);

export function callBuiltin(name: string, args: Value[]): Value {
  const fn = BUILTINS[name];
  if (!fn) {
    if (UNSUPPORTED_BUILTINS.has(name)) {
      const why = name.startsWith('tex') ? 'textures arrive in a later stage' : name.startsWith('dF') || name === 'fwidth' ? 'derivatives need neighbouring pixels' : 'not implemented yet';
      throw new GlslRuntimeError(`The stepper can't run ${name}() yet (${why}).`);
    }
    throw new GlslRuntimeError(`Unknown function ${name}()`);
  }
  for (const a of args) {
    if (isMatrix(a.type) && !['matrixCompMult', 'transpose', 'determinant', 'inverse'].includes(name)) {
      throw new GlslRuntimeError(`${name}() doesn't take a ${typeName(a.type)}`);
    }
  }
  return fn(args);
}

export const isBuiltin = (name: string) => name in BUILTINS || UNSUPPORTED_BUILTINS.has(name);

// Re-exported for tests.
export { matMul, isScalar };
