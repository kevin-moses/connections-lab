import {
  GlslRuntimeError,
  isMatrix,
  isScalar,
  isVector,
  make,
  type,
  typeName,
  BOOL,
  type Base,
  type Type,
  type Value,
} from './values';

/**
 * Apply `f` component-wise, broadcasting a scalar operand. The result has the
 * non-scalar operand's shape and `base` (defaults to the operands' base).
 */
export function zip(a: Value, b: Value, f: (x: number, y: number) => number, base?: Base): Value {
  let shape: Type;
  if (isScalar(a.type)) shape = b.type;
  else if (isScalar(b.type) || sameShape(a.type, b.type)) shape = a.type;
  else throw new GlslRuntimeError(`can't combine ${typeName(a.type)} and ${typeName(b.type)}`);
  const n = shape.rows * shape.cols;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = f(a.data[isScalar(a.type) ? 0 : i], b.data[isScalar(b.type) ? 0 : i]);
  return make(type(base ?? shape.base, shape.rows, shape.cols), out);
}

export function zip3(
  a: Value,
  b: Value,
  c: Value,
  f: (x: number, y: number, z: number) => number,
): Value {
  const shape = [a, b, c].find((v) => !isScalar(v.type))?.type ?? a.type;
  const n = shape.rows * shape.cols;
  const at = (v: Value, i: number) => v.data[isScalar(v.type) ? 0 : i];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = f(at(a, i), at(b, i), at(c, i));
  // clamp(int, …) stays int; smoothstep(float, float, vec3) → vec3.
  return make(type(a.type.base, shape.rows, shape.cols), out);
}

export function map(a: Value, f: (x: number) => number, base?: Base): Value {
  return make(type(base ?? a.type.base, a.type.rows, a.type.cols), a.data.map(f));
}

const sameShape = (a: Type, b: Type) => a.rows === b.rows && a.cols === b.cols;

const isIntegral = (b: Base) => b === 'int' || b === 'uint';

function divide(base: Base) {
  return (x: number, y: number) => (isIntegral(base) ? (y === 0 ? 0 : Math.trunc(x / y)) : x / y);
}

export function matMul(a: Value, b: Value): Value {
  const A = a.type;
  const B = b.type;
  // mat * vec
  if (isMatrix(A) && isVector(B)) {
    if (A.cols !== B.rows) throw new GlslRuntimeError(`can't multiply ${typeName(A)} by ${typeName(B)}`);
    const out: number[] = [];
    for (let r = 0; r < A.rows; r++) {
      let s = 0;
      for (let c = 0; c < A.cols; c++) s += a.data[c * A.rows + r] * b.data[c];
      out.push(s);
    }
    return make(type('float', A.rows), out);
  }
  // vec * mat
  if (isVector(A) && isMatrix(B)) {
    if (A.rows !== B.rows) throw new GlslRuntimeError(`can't multiply ${typeName(A)} by ${typeName(B)}`);
    const out: number[] = [];
    for (let c = 0; c < B.cols; c++) {
      let s = 0;
      for (let r = 0; r < B.rows; r++) s += a.data[r] * b.data[c * B.rows + r];
      out.push(s);
    }
    return make(type('float', B.cols), out);
  }
  // mat * mat
  if (A.cols !== B.rows) throw new GlslRuntimeError(`can't multiply ${typeName(A)} by ${typeName(B)}`);
  const out: number[] = [];
  for (let c = 0; c < B.cols; c++) {
    for (let r = 0; r < A.rows; r++) {
      let s = 0;
      for (let k = 0; k < A.cols; k++) s += a.data[k * A.rows + r] * b.data[c * B.rows + k];
      out.push(s);
    }
  }
  return make(type('float', A.rows, B.cols), out);
}

function allEqual(a: Value, b: Value): boolean {
  if (a.data.length !== b.data.length) return false;
  return a.data.every((x, i) => x === b.data[i]);
}

/** Binary operators except `&&` / `||` (short-circuit, handled by the interpreter) and `,`. */
export function binary(op: string, a: Value, b: Value): Value {
  const base = isScalar(a.type) ? b.type.base : a.type.base;
  switch (op) {
    case '+':
      return zip(a, b, (x, y) => x + y);
    case '-':
      return zip(a, b, (x, y) => x - y);
    case '*':
      if ((isMatrix(a.type) && !isScalar(b.type)) || (isMatrix(b.type) && !isScalar(a.type))) return matMul(a, b);
      return zip(a, b, (x, y) => (isIntegral(base) ? Math.imul(x, y) : x * y));
    case '/':
      return zip(a, b, divide(base));
    case '%':
      return zip(a, b, (x, y) => (y === 0 ? 0 : x % y));
    case '<':
      return make(BOOL, [a.data[0] < b.data[0] ? 1 : 0]);
    case '>':
      return make(BOOL, [a.data[0] > b.data[0] ? 1 : 0]);
    case '<=':
      return make(BOOL, [a.data[0] <= b.data[0] ? 1 : 0]);
    case '>=':
      return make(BOOL, [a.data[0] >= b.data[0] ? 1 : 0]);
    case '==':
      return make(BOOL, [allEqual(a, b) ? 1 : 0]);
    case '!=':
      return make(BOOL, [allEqual(a, b) ? 0 : 1]);
    case '^^':
      return make(BOOL, [(a.data[0] !== 0) !== (b.data[0] !== 0) ? 1 : 0]);
    case '&':
      return zip(a, b, (x, y) => x & y);
    case '|':
      return zip(a, b, (x, y) => x | y);
    case '^':
      return zip(a, b, (x, y) => x ^ y);
    case '<<':
      return zip(a, b, (x, y) => x << y, a.type.base);
    case '>>':
      return zip(a, b, (x, y) => (a.type.base === 'uint' ? x >>> y : x >> y), a.type.base);
  }
  throw new GlslRuntimeError(`operator ${op} isn't supported`);
}

export function unary(op: string, a: Value): Value {
  switch (op) {
    case '-':
      return map(a, (x) => -x);
    case '+':
      return a;
    case '!':
      return map(a, (x) => (x ? 0 : 1));
    case '~':
      return map(a, (x) => ~x);
  }
  throw new GlslRuntimeError(`operator ${op} isn't supported`);
}

/** `a += b` etc. → the binary operator. */
export function compoundOperator(op: string): string | null {
  return op === '=' ? null : op.slice(0, -1);
}
