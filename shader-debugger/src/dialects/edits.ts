import { visit, type AstNode, type Path, type Program } from '@shaderfrog/glsl-parser/ast';

/**
 * Small text edits located by the parser, so names in comments or inside
 * other identifiers are never touched and everything else is kept byte for
 * byte. Shared by the dialect converters.
 */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

type Loc = { location?: { start: { offset: number; line: number }; end: { offset: number } } };
export const span = (n: unknown) => (n as Loc).location!;

export interface DeclaratorList {
  specified_type: { qualifiers?: { type: string; token?: string }[] | null; specifier: unknown };
  declarations: { identifier: { identifier: string } }[];
}

export function declaratorList(stmt: AstNode): DeclaratorList | null {
  if (stmt.type !== 'declaration_statement') return null;
  const d = (stmt as unknown as { declaration: AstNode }).declaration;
  return d.type === 'declarator_list' ? (d as unknown as DeclaratorList) : null;
}

export function isPrecision(stmt: AstNode): boolean {
  return stmt.type === 'declaration_statement' && (stmt as unknown as { declaration: AstNode }).declaration.type === 'precision';
}

export function isVersion(stmt: AstNode): boolean {
  return stmt.type === 'preprocessor' && /^#\s*version\b/.test((stmt as unknown as { line: string }).line);
}

export function replaceToken(node: unknown, text: string): Edit {
  const loc = span(node);
  const token = (node as { token: string }).token;
  return { start: loc.start.offset, end: loc.start.offset + token.length, text };
}

/** Every identifier name used anywhere (variables, functions, parameters). */
export function identifierNames(node: Program | AstNode): Set<string> {
  const names = new Set<string>();
  visit(node as Program, {
    identifier: { enter: (p: Path<AstNode>) => void names.add((p.node as unknown as { identifier: string }).identifier) },
  });
  return names;
}

/**
 * What to replace an identifier with. `swizzle` is the component selection
 * right after it (`.xy` in `u_resolution.xy`), if any; return `keepSwizzle:
 * false` to replace that too.
 */
export type Rename = (name: string, swizzle: string | null) => string | { text: string; keepSwizzle: boolean } | null;

/** Rename identifiers (variables and function calls) inside `node` that `rename` maps. */
export function renameAll(node: Program | AstNode, source: string, edits: Edit[], rename: Rename): void {
  visit(node as Program, {
    identifier: {
      enter: (p: Path<AstNode>) => {
        const name = (p.node as unknown as { identifier: string }).identifier;
        const start = span(p.node).start.offset;
        const sw = /^\s*\.\s*([A-Za-z]+)\b/.exec(source.slice(start + name.length));
        const r = rename(name, sw ? sw[1] : null);
        if (r === null) return;
        const { text, keepSwizzle } = typeof r === 'string' ? { text: r, keepSwizzle: true } : r;
        edits.push({ start, end: start + name.length + (keepSwizzle || !sw ? 0 : sw[0].length), text });
      },
    },
  });
}

/** True when a swizzle only reads the first two components (x/y, r/g or s/t). */
export const firstTwoOnly = (swizzle: string | null) => !!swizzle && /^(?:[xy]+|[rg]+|[st]+)$/.test(swizzle);

/** Just past a statement's `;` (its location also covers the whitespace after it). */
export function statementEnd(stmt: AstNode): number {
  return span((stmt as unknown as { semi: unknown }).semi).start.offset + 1;
}

export function lineEnd(source: string, at: number): number {
  const i = source.indexOf('\n', at);
  return i < 0 ? source.length : i;
}

/** The whitespace at the start of the line holding `at`. */
export function indentAt(source: string, at: number): string {
  const start = source.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*/.exec(source.slice(start))![0];
}

/**
 * The range to delete for `from..to`: the whole line(s), newline included,
 * when nothing else is on them (plus one blank line, if it would otherwise
 * leave two in a row); just the range when the line holds other code.
 */
export function wholeLines(source: string, from: number, to: number): { start: number; end: number } {
  const start = source.lastIndexOf('\n', from - 1) + 1;
  const endOfLine = lineEnd(source, Math.max(to - 1, from));
  const rest = source.slice(to, endOfLine);
  const before = source.slice(start, from);
  if (before.trim() || rest.replace(/\/\/.*$/, '').trim()) return { start: from, end: to };
  const end = Math.min(source.length, endOfLine + 1);
  const prevBlank = start === 0 || /\n[ \t]*\n$/.test(source.slice(0, start)) || /^[ \t]*\n$/.test(source.slice(0, start));
  const nextLine = /^[ \t]*(\n|$)/.exec(source.slice(end));
  return prevBlank && nextLine && end < source.length ? { start, end: end + nextLine[0].length } : { start, end };
}

/** Delete a whole statement (its line, if it's alone on it). */
export function removeStatement(source: string, stmt: AstNode): Edit {
  const end = stmt.type === 'preprocessor' ? lineEnd(source, span(stmt).start.offset) : statementEnd(stmt);
  return { ...wholeLines(source, span(stmt).start.offset, end), text: '' };
}

/** Apply edits right to left. Edits inside a deletion (an edit with empty text over a range) are dropped. */
export function apply(source: string, edits: Edit[]): string {
  const deletions = edits.filter((e) => e.text === '' && e.end > e.start);
  // An insertion exactly at a deletion's edge survives it.
  const inside = (e: Edit, d: Edit) => (e.start === e.end ? e.start > d.start && e.start < d.end : e.start >= d.start && e.end <= d.end);
  const kept = edits.filter((e) => deletions.includes(e) || !deletions.some((d) => inside(e, d)));
  let out = source;
  for (const e of [...kept].sort((a, b) => b.start - a.start || b.end - a.end)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
