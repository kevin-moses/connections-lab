import { visit, type Path } from '@shaderfrog/glsl-parser/ast';
import type {
  AstNode,
  Program,
  DeclarationStatementNode,
  ExpressionStatementNode,
  ReturnStatementNode,
  FunctionNode,
  IdentifierNode,
  PostfixNode,
} from '@shaderfrog/glsl-parser/ast';

/**
 * Where to capture a value, and which value. All offsets are into the
 * learner's source.
 *
 * Capture happens right after the statement runs, so the value shown is the
 * value *after* that line.
 */
export interface ProbeTarget {
  /** GLSL expression to capture, e.g. `uv`, `uv.x`, `x * 2.0`. */
  expr: string;
  /** What the UI calls it. */
  label: string;
  /** 1-based line of the statement (where the value is captured). */
  line: number;
  /** Enclosing function. */
  functionName: string;
  /** Source range of the probed expression, for highlighting. */
  exprRange: [number, number] | null;
  insert: ProbeInsert;
}

export type ProbeInsert =
  /** Statement sits in a `{ }` block: append capture after its `;`. */
  | { kind: 'after'; offset: number }
  /** Statement is a braceless if/loop body: wrap it as `{ stmt capture }`. */
  | { kind: 'wrap'; start: number; end: number }
  /** `return E;` — capture E, then return it. */
  | { kind: 'return'; start: number; end: number; exprStart: number; exprEnd: number };

type Stmt = DeclarationStatementNode | ExpressionStatementNode | ReturnStatementNode;

interface Candidate {
  node: Stmt;
  start: number;
  /** Offset just past the `;`. */
  end: number;
  inBlock: boolean;
  functionName: string;
}

const CONTROL_BODY_PARENTS = new Set(['if_statement', 'for_statement', 'while_statement', 'do_statement']);

/**
 * Pick the probe target for a cursor position: the innermost statement that
 * contains the cursor, and the identifier under the cursor (or the variable
 * the statement assigns when the cursor isn't on one).
 */
export function resolveProbeTarget(ast: Program, source: string, cursor: number): ProbeTarget | null {
  const candidates = collectStatements(ast);
  // Any statement touching the cursor's line is eligible; prefer one the
  // cursor is actually inside, then the smallest (innermost).
  const cursorLine = lineOf(source, cursor);
  const onLine = candidates.filter(
    (c) => lineOf(source, c.start) <= cursorLine && cursorLine <= lineOf(source, c.end - 1),
  );
  const inside = onLine.filter((c) => cursor >= c.start && cursor <= c.end);
  const stmt = (inside.length ? inside : onLine).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  if (!stmt) return null;

  const line = lineOf(source, stmt.start);
  const node = stmt.node;

  if (node.type === 'return_statement') {
    if (!node.expression) return null; // bare `return;`
    // Binary expressions carry no location, so measure from the keyword.
    const afterKeyword = node.return.location!.start.offset + 'return'.length;
    const exprEnd = node.semi.location!.start.offset;
    const raw = source.slice(afterKeyword, exprEnd);
    const exprStart = afterKeyword + (raw.length - raw.trimStart().length);
    const expr = raw.trim();
    const clicked = expressionAt(node, source, cursor);
    // Clicking a variable inside the return expression probes that variable;
    // otherwise probe the returned value.
    if (clicked) {
      return {
        ...clicked,
        line,
        functionName: stmt.functionName,
        insert: { kind: 'return', start: stmt.start, end: stmt.end, exprStart, exprEnd },
      };
    }
    return {
      expr,
      label: `${stmt.functionName}() returns`,
      line,
      functionName: stmt.functionName,
      exprRange: [exprStart, exprStart + expr.length],
      insert: { kind: 'return', start: stmt.start, end: stmt.end, exprStart, exprEnd },
    };
  }

  const picked = expressionAt(node, source, cursor) ?? defaultExpression(node, source);
  if (!picked) return null;

  return {
    ...picked,
    line,
    functionName: stmt.functionName,
    insert: stmt.inBlock
      ? { kind: 'after', offset: stmt.end }
      : { kind: 'wrap', start: stmt.start, end: stmt.end },
  };
}

function collectStatements(ast: Program): Candidate[] {
  const out: Candidate[] = [];
  const functionOf = (p: Path<unknown>): string | null => {
    const fn = p.findParent((pp) => (pp.node as AstNode)?.type === 'function');
    return fn ? (fn.node as FunctionNode).prototype.header.name.identifier : null;
  };
  const add = (p: Path<Stmt>) => {
    const fnName = functionOf(p);
    if (!fnName) return; // global declarations aren't statements we can probe after
    const parentType = (p.parent as AstNode | undefined)?.type;
    const inBlock = parentType === 'compound_statement';
    // A declaration in a `for (...)` header is not a body statement.
    if (!inBlock && !(CONTROL_BODY_PARENTS.has(parentType ?? '') && p.key === 'body')) return;
    const node = p.node;
    if (node.type === 'declaration_statement' && node.declaration.type !== 'declarator_list') return;
    out.push({
      node,
      start: node.location!.start.offset,
      end: node.semi.location!.start.offset + 1,
      inBlock,
      functionName: fnName,
    });
  };
  visit(ast, {
    declaration_statement: { enter: add },
    expression_statement: { enter: add },
    return_statement: { enter: add },
  });
  return out;
}

type Picked = Pick<ProbeTarget, 'expr' | 'label' | 'exprRange'>;

/**
 * The variable under the cursor. On `uv` in `uv.x` that's the whole `uv`;
 * on the `.x` part it's `uv.x`. Function names are ignored.
 */
function expressionAt(stmt: Stmt, source: string, cursor: number): Picked | null {
  let best: Picked | null = null;

  visit(stmt, {
    identifier: {
      enter: (p: Path<IdentifierNode>) => {
        const parent = p.parent as AstNode | undefined;
        if (parent?.type === 'function_call' && p.key === 'identifier') return;
        if (parent?.type === 'field_selection') return; // the `x` in `uv.x`
        const start = p.node.location!.start.offset;
        const name = p.node.identifier;
        const end = start + name.length;
        if (cursor < start || cursor > end) return;
        best = { expr: name, label: name, exprRange: [start, end] };
      },
    },
    // Cursor on the `.x` part of `uv.x`.
    postfix: {
      enter: (p: Path<PostfixNode>) => {
        const n = p.node;
        if ((n.expression as AstNode).type !== 'identifier') return;
        if ((n.postfix as AstNode).type !== 'field_selection') return;
        const name = (n.expression as IdentifierNode).identifier;
        const sel = selectionName(n.postfix);
        const start = n.location!.start.offset;
        const expr = `${name}.${sel}`;
        const end = start + expr.length;
        if (cursor > start + name.length && cursor <= end && source.slice(start, end) === expr) {
          best = { expr, label: expr, exprRange: [start, end] };
        }
      },
    },
  });

  return best;
}

/** `.xy` → `xy`. The parser stores the selection as an identifier node. */
function selectionName(fieldSelection: AstNode): string {
  const sel = (fieldSelection as unknown as { selection: { identifier?: string; literal?: string } }).selection;
  return sel.identifier ?? sel.literal ?? '';
}

/** The variable a statement declares or assigns to. */
function defaultExpression(stmt: Stmt, _source: string): Picked | null {
  if (stmt.type === 'declaration_statement' && stmt.declaration.type === 'declarator_list') {
    const decl = stmt.declaration.declarations[0];
    if (!decl || decl.quantifier?.length) return null; // arrays: not yet
    const id = decl.identifier;
    const start = id.location!.start.offset;
    return { expr: id.identifier, label: id.identifier, exprRange: [start, start + id.identifier.length] };
  }

  if (stmt.type === 'expression_statement') {
    const id = baseIdentifier(stmt.expression as AstNode);
    if (!id) return null;
    const start = id.location!.start.offset;
    return { expr: id.identifier, label: id.identifier, exprRange: [start, start + id.identifier.length] };
  }

  return null;
}

/** Leftmost variable of an assignment / increment: `col.rg = …` → `col`. */
function baseIdentifier(expr: AstNode | undefined): IdentifierNode | null {
  let node = expr;
  for (let i = 0; node && i < 8; i++) {
    switch (node.type) {
      case 'identifier':
        return node;
      case 'assignment':
        node = node.left as AstNode;
        break;
      case 'postfix':
        node = node.expression as AstNode;
        break;
      case 'unary':
        node = (node as unknown as { expression: AstNode }).expression;
        break;
      default:
        return null;
    }
  }
  return null;
}

/** 1-based line number of an offset. */
export function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}
