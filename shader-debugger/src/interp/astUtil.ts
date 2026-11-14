import { generate, parser } from '@shaderfrog/glsl-parser';
import type { AstNode, FunctionNode } from '@shaderfrog/glsl-parser/ast';
import {
  FLOAT,
  GlslRuntimeError,
  indexValue,
  isArrayValue,
  make,
  type,
  typeName,
  zero,
  zeroArray,
  type AnyValue,
  type Type,
  type Value,
} from './values';

/** AST and value helpers for the interpreter: shapes the parser produces, literals, l-value nodes. */

/** Parse a standalone GLSL expression. */
export function parseExpression(expression: string): AstNode {
  const prog = parser.parse(`void __e() { __x = (${expression}); }`, { quiet: true });
  const fn = prog.program[0] as FunctionNode;
  const stmt = fn.body.statements[0] as unknown as { expression: { right: AstNode } };
  const group = stmt.expression.right as unknown as { expression: AstNode };
  return group.expression;
}

export interface ArrayDecl {
  elem: Type;
  length: number;
}

export interface PostOp {
  type: string;
  literal?: string;
  selection?: { identifier?: string; literal?: string };
  expression?: AstNode;
}

/**
 * The parser nests postfix chains oddly: `m[1][1]` is
 * postfix(m, postfix([1], [1])). Flatten to a base plus ordered operations.
 */
export function flattenPostfix(node: AstNode): { base: AstNode; ops: PostOp[] } {
  const n = node as unknown as { expression: AstNode; postfix: AstNode };
  const ops: PostOp[] = [];
  const collect = (p: AstNode) => {
    if (p.type === 'postfix') {
      const pp = p as unknown as { expression: AstNode; postfix: AstNode };
      collect(pp.expression);
      collect(pp.postfix);
    } else ops.push(p as unknown as PostOp);
  };
  collect(n.postfix);
  return { base: n.expression, ops };
}

export const VOID = { elem: FLOAT, length: -1 } as unknown as Type;

export function signatureOf(t: Type | ArrayDecl): string {
  if (t === VOID) return 'void';
  if ('length' in t) return `${typeName(t.elem)}[${t.length}]`;
  return typeName(t);
}

export function parseIntLiteral(token: string): Value {
  const unsigned = /[uU]$/.test(token);
  const body = token.replace(/[uU]$/, '');
  let n: number;
  if (/^0[xX]/.test(body)) n = parseInt(body.slice(2), 16);
  else if (/^0\d/.test(body)) n = parseInt(body, 8);
  else n = parseInt(body, 10);
  return make(type(unsigned ? 'uint' : 'int'), [n]);
}

export function indexAny(base: AnyValue, i: number): Value {
  if (isArrayValue(base)) {
    if (i < 0 || i >= base.items.length) throw new GlslRuntimeError(`Index ${i} is out of range for an array of ${base.items.length}.`);
    return base.items[i];
  }
  return indexValue(base, i);
}

export function oneLike(v: Value): Value {
  return make(type(v.type.base), [1]);
}

export function zeroLike(v: AnyValue): AnyValue {
  return isArrayValue(v) ? zeroArray(v.elem, v.items.length) : zero(v.type);
}

export function isLValueNode(n: AstNode): boolean {
  return n.type === 'identifier' || n.type === 'postfix' || n.type === 'group';
}

/** The for-loop condition can be a `condition_expression` wrapper. */
export function conditionExpr(node: AstNode): AstNode {
  const n = node as unknown as { type: string; expression?: AstNode };
  if (n.type === 'expression_statement' && n.expression) return n.expression;
  return node;
}

export function exprText(node: AstNode): string {
  try {
    return generate(node).replace(/\s+/g, ' ').trim();
  } catch {
    return '…';
  }
}
