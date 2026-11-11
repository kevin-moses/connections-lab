/**
 * GLSL values for the CPU interpreter.
 *
 * Every non-array value is a flat list of numbers plus a type. Matrices are
 * column-major (data[col * rows + row]) like GLSL. Floats are rounded to
 * float32 (Math.fround) on every write so results match the GPU's highp.
 */

export type Base = 'float' | 'int' | 'uint' | 'bool';

export interface Type {
  base: Base;
  /** Components for vectors; rows for matrices; 1 for scalars. */
  rows: number;
  /** Columns for matrices; 1 for scalars and vectors. */
  cols: number;
}

export interface Value {
  type: Type;
  data: number[];
}

export interface ArrayValue {
  elem: Type;
  items: Value[];
}

export type AnyValue = Value | ArrayValue;

export const isArrayValue = (v: AnyValue): v is ArrayValue => 'items' in v;

export class GlslRuntimeError extends Error {
  constructor(
    message: string,
    public line: number | null = null,
  ) {
    super(message);
  }
}

// ---------- types ----------

export const type = (base: Base, rows = 1, cols = 1): Type => ({ base, rows, cols });
export const FLOAT = type('float');
export const INT = type('int');
export const UINT = type('uint');
export const BOOL = type('bool');
export const VEC2 = type('float', 2);
export const VEC3 = type('float', 3);
export const VEC4 = type('float', 4);

export const isScalar = (t: Type) => t.rows === 1 && t.cols === 1;
export const isVector = (t: Type) => t.cols === 1 && t.rows > 1;
export const isMatrix = (t: Type) => t.cols > 1;
export const sizeOf = (t: Type) => t.rows * t.cols;
export const sameType = (a: Type, b: Type) => a.base === b.base && a.rows === b.rows && a.cols === b.cols;

const VEC_PREFIX: Record<string, Base> = { '': 'float', i: 'int', u: 'uint', b: 'bool' };

/** `vec3` → {float,3,1}; `mat2x3` → {float, rows 3, cols 2}. Null for unknown names. */
export function parseTypeName(name: string): Type | null {
  if (name === 'float' || name === 'int' || name === 'uint' || name === 'bool') return type(name);
  let m = /^([iub]?)vec([234])$/.exec(name);
  if (m) return type(VEC_PREFIX[m[1]], Number(m[2]));
  m = /^mat([234])(?:x([234]))?$/.exec(name);
  if (m) {
    const cols = Number(m[1]);
    const rows = m[2] ? Number(m[2]) : cols;
    return type('float', rows, cols);
  }
  return null;
}

export function typeName(t: Type): string {
  if (isScalar(t)) return t.base;
  if (isVector(t)) return `${{ float: '', int: 'i', uint: 'u', bool: 'b' }[t.base]}vec${t.rows}`;
  return t.rows === t.cols ? `mat${t.cols}` : `mat${t.cols}x${t.rows}`;
}

export function valueTypeName(v: AnyValue): string {
  return isArrayValue(v) ? `${typeName(v.elem)}[${v.items.length}]` : typeName(v.type);
}

// ---------- numbers ----------

/** Normalize a JS number to what the given base type can hold. */
export function norm(base: Base, x: number): number {
  switch (base) {
    case 'float':
      return Math.fround(x);
    case 'int':
      return Number.isFinite(x) ? Math.trunc(x) | 0 : 0;
    case 'uint':
      return Number.isFinite(x) ? Math.trunc(x) >>> 0 : 0;
    case 'bool':
      return x ? 1 : 0;
  }
}

/** Convert a component between base types (constructor semantics). */
export function convert(x: number, from: Base, to: Base): number {
  if (to === 'bool') return x !== 0 ? 1 : 0;
  if (from === 'bool') return x ? 1 : 0;
  if (to === 'uint' && from === 'int') return x >>> 0;
  if (to === 'int' && from === 'uint') return x | 0;
  return norm(to, x);
}

export function make(t: Type, data: number[]): Value {
  return { type: t, data: data.map((x) => norm(t.base, x)) };
}

export const scalar = (base: Base, x: number): Value => make(type(base), [x]);
export const float = (x: number): Value => scalar('float', x);
export const int = (x: number): Value => scalar('int', x);
export const bool = (x: boolean): Value => scalar('bool', x ? 1 : 0);
export const vec = (...xs: number[]): Value => make(type('float', xs.length), xs);

export function clone<V extends AnyValue>(v: V): V {
  if (isArrayValue(v)) return { elem: v.elem, items: v.items.map((i) => clone(i)) } as V;
  return { type: v.type, data: v.data.slice() } as V;
}

export function zero(t: Type): Value {
  return { type: t, data: new Array(sizeOf(t)).fill(0) };
}

export function zeroArray(elem: Type, length: number): ArrayValue {
  return { elem, items: Array.from({ length }, () => zero(elem)) };
}

export function truthy(v: Value): boolean {
  return v.data[0] !== 0;
}

// ---------- constructors ----------

/** GLSL constructor semantics: `vec3(1.0)`, `vec4(v.xy, 0.0, 1.0)`, `mat2(1.0)`, `int(2.7)`. */
export function construct(t: Type, args: AnyValue[]): Value {
  const vals = args.map((a) => {
    if (isArrayValue(a)) throw new GlslRuntimeError(`can't pass an array to ${typeName(t)}()`);
    return a;
  });
  if (vals.length === 0) throw new GlslRuntimeError(`${typeName(t)}() needs arguments`);

  const n = sizeOf(t);
  const first = vals[0];

  if (isScalar(t)) return make(t, [convert(first.data[0], first.type.base, t.base)]);

  if (vals.length === 1 && isScalar(first.type)) {
    const x = convert(first.data[0], first.type.base, t.base);
    if (isMatrix(t)) {
      // diagonal matrix
      const data = new Array(n).fill(0);
      for (let i = 0; i < Math.min(t.rows, t.cols); i++) data[i * t.rows + i] = x;
      return make(t, data);
    }
    return make(t, new Array(n).fill(x));
  }

  if (isMatrix(t) && vals.length === 1 && isMatrix(first.type)) {
    // matrix from matrix: copy the overlap, identity elsewhere
    const src = first.type;
    const data: number[] = [];
    for (let c = 0; c < t.cols; c++) {
      for (let r = 0; r < t.rows; r++) {
        data.push(c < src.cols && r < src.rows ? first.data[c * src.rows + r] : c === r ? 1 : 0);
      }
    }
    return make(t, data);
  }

  const flat: number[] = [];
  for (const v of vals) for (const x of v.data) flat.push(convert(x, v.type.base, t.base));
  if (flat.length < n) throw new GlslRuntimeError(`not enough data for ${typeName(t)}()`);
  return make(t, flat.slice(0, n));
}

// ---------- swizzles ----------

const SWIZZLE_SETS = ['xyzw', 'rgba', 'stpq'];

/** `"zyx"` → [2, 1, 0]; null if not a valid swizzle. */
export function swizzleIndices(sel: string): number[] | null {
  if (sel.length < 1 || sel.length > 4) return null;
  for (const set of SWIZZLE_SETS) {
    const idx = [...sel].map((ch) => set.indexOf(ch));
    if (idx.every((i) => i >= 0)) return idx;
  }
  return null;
}

export function swizzle(v: Value, sel: string): Value {
  const idx = swizzleIndices(sel);
  if (!idx || !isVector(v.type)) throw new GlslRuntimeError(`can't select .${sel} from ${typeName(v.type)}`);
  if (idx.some((i) => i >= v.type.rows)) throw new GlslRuntimeError(`.${sel} is out of range for ${typeName(v.type)}`);
  const data = idx.map((i) => v.data[i]);
  return { type: type(v.type.base, idx.length), data };
}

/** Matrix column, vector component, or (handled elsewhere) array element. */
export function indexValue(v: Value, i: number): Value {
  if (isMatrix(v.type)) {
    if (i < 0 || i >= v.type.cols) throw new GlslRuntimeError(`column ${i} is out of range for ${typeName(v.type)}`);
    return { type: type('float', v.type.rows), data: v.data.slice(i * v.type.rows, (i + 1) * v.type.rows) };
  }
  if (isVector(v.type)) {
    if (i < 0 || i >= v.type.rows) throw new GlslRuntimeError(`index ${i} is out of range for ${typeName(v.type)}`);
    return { type: type(v.type.base), data: [v.data[i]] };
  }
  throw new GlslRuntimeError(`can't index a ${typeName(v.type)}`);
}

// ---------- display ----------

export function formatNumber(x: number, base: Base = 'float'): string {
  if (base === 'bool') return x ? 'true' : 'false';
  if (base !== 'float') return String(x);
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return x.toExponential(2);
  return Number(x.toFixed(4)).toString();
}

export function formatValue(v: AnyValue): string {
  if (isArrayValue(v)) return `[${v.items.map(formatValue).join(', ')}]`;
  const parts = v.data.map((x) => formatNumber(x, v.type.base));
  if (isScalar(v.type)) return parts[0];
  if (isMatrix(v.type)) {
    const cols: string[] = [];
    for (let c = 0; c < v.type.cols; c++) cols.push(`(${parts.slice(c * v.type.rows, (c + 1) * v.type.rows).join(', ')})`);
    return `[${cols.join(', ')}]`;
  }
  return `(${parts.join(', ')})`;
}
