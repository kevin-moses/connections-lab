import type { AstNode, Program } from '@shaderfrog/glsl-parser/ast';
import { apply, declaratorList, identifierNames, isPrecision, isVersion, lineEnd, removeStatement, renameAll, replaceToken, statementEnd, type Edit } from './edits';
import type { Converted } from './convert';

/**
 * Between modern GLSL ES 3.00 (what lessons are written in) and p5 style,
 * GLSL ES 1.00 as in p5's docs and most tutorials:
 *
 *   out vec4 fragColor;   ↔  (built-in gl_FragColor)
 *   in vec2 vTexCoord;    ↔  varying vec2 vTexCoord;
 *   texture(…)            ↔  texture2D(…)
 *   #version 300 es       ↔  (none)
 */
export function es300ToP5(ast: Program, source: string): Converted {
  const edits: Edit[] = [];
  const outputs = new Set<string>();

  for (const stmt of ast.program as AstNode[]) {
    if (isVersion(stmt)) {
      edits.push(removeStatement(source, stmt));
      continue;
    }
    const list = declaratorList(stmt);
    if (!list) continue;
    const quals = list.specified_type.qualifiers ?? [];
    if (quals.some((q) => q.token === 'out')) {
      for (const d of list.declarations) outputs.add(d.identifier.identifier);
      edits.push(removeStatement(source, stmt));
    } else {
      const inQ = quals.find((q) => q.token === 'in');
      if (inQ) edits.push(replaceToken(inQ, 'varying'));
    }
  }

  if (outputs.size > 1) return { ok: false, reason: 'p5 style has one output (gl_FragColor), and this shader declares several.' };
  const output = outputs.size === 1 ? [...outputs][0] : null;
  renameAll(ast, source, edits, (name) => (name === output ? 'gl_FragColor' : name === 'texture' ? 'texture2D' : null));
  return { ok: true, code: apply(source, edits) };
}

export function p5ToEs300(ast: Program, source: string): Converted {
  const edits: Edit[] = [];
  const names = identifierNames(ast);
  const output = ['fragColor', 'outColor', 'sd_color'].find((n) => !names.has(n))!;
  let afterPrecision: number | null = null;

  for (const stmt of ast.program as AstNode[]) {
    if (isVersion(stmt)) {
      edits.push(removeStatement(source, stmt));
      continue;
    }
    if (isPrecision(stmt)) afterPrecision = lineEnd(source, statementEnd(stmt));
    const q = declaratorList(stmt)?.specified_type.qualifiers?.find((k) => k.token === 'varying');
    if (q) edits.push(replaceToken(q, 'in'));
  }

  renameAll(ast, source, edits, (name) => (name === 'gl_FragColor' ? output : name === 'texture2D' || name === 'textureCube' ? 'texture' : null));
  if (names.has('gl_FragColor')) {
    const decl = `out vec4 ${output};`;
    edits.push(afterPrecision === null ? { start: 0, end: 0, text: `${decl}\n` } : { start: afterPrecision, end: afterPrecision, text: `\n${decl}` });
  }
  return { ok: true, code: apply(source, edits) };
}
