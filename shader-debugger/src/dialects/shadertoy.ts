import type { AstNode, FunctionNode, Program } from '@shaderfrog/glsl-parser/ast';
import { SHADERTOY_UNIFORMS } from '../glsl/shadertoy';
import {
  apply,
  declaratorList,
  firstTwoOnly,
  identifierNames,
  indentAt,
  isPrecision,
  isVersion,
  removeStatement,
  renameAll,
  span,
  statementEnd,
  type Edit,
} from './edits';
import type { Converted } from './convert';

/**
 * Between the app's GLSL ES 3.00 and a Shadertoy image shader:
 *
 *   void main()  + out vec4 fragColor;   ↔  void mainImage(out vec4 fragColor, in vec2 fragCoord)
 *   gl_FragCoord.xy (in main)             ↔  fragCoord
 *   u_resolution / u_time / u_mouse       ↔  iResolution.xy / iTime / iMouse.xy
 *   precision, uniform and #version lines ↔  (Shadertoy declares them)
 *
 * Other Shadertoy inputs (iFrame, iDate, iChannel0, ...) keep their names;
 * converted to ES 3.00 they become declared uniforms, which the app supplies.
 */

const APP_UNIFORMS = new Set(['u_resolution', 'u_time', 'u_mouse']);
const CANONICAL_DECLS: Record<string, string> = {
  iResolution: 'uniform vec2 u_resolution;  // canvas size in pixels',
  iTime: 'uniform float u_time;        // seconds since start',
  iMouse: 'uniform vec2 u_mouse;       // mouse position in pixels',
};

interface Fn {
  name: string;
  node: FunctionNode;
}

function functions(ast: Program): Fn[] {
  return (ast.program as AstNode[])
    .filter((n) => n.type === 'function')
    .map((n) => ({ name: (n as FunctionNode).prototype.header.name.identifier, node: n as FunctionNode }));
}

/** From `main` to just past its `)`: the part of the header that changes. */
function headerRange(fn: FunctionNode): { start: number; end: number } {
  const proto = fn.prototype as unknown as { header: { name: unknown }; rp: unknown };
  return { start: span(proto.header.name).start.offset, end: span(proto.rp).start.offset + 1 };
}

function statements(fn: FunctionNode): AstNode[] {
  return ((fn.body as unknown as { statements?: AstNode[] }).statements ?? []) as AstNode[];
}

export function es300ToShadertoy(ast: Program, source: string): Converted {
  const edits: Edit[] = [];
  const fns = functions(ast);
  const main = fns.find((f) => f.name === 'main');
  if (!main) return { ok: false, reason: 'There is no main() to turn into mainImage().' };
  const outputs: string[] = [];

  for (const stmt of ast.program as AstNode[]) {
    if (isVersion(stmt)) {
      edits.push(removeStatement(source, stmt));
      continue;
    }
    if (isPrecision(stmt)) {
      // Shadertoy already uses highp floats and ints.
      const d = (stmt as unknown as { declaration: { qualifier: { token: string }; specifier: { specifier: { token: string } } } }).declaration;
      if (d.qualifier.token === 'highp' && ['float', 'int'].includes(d.specifier.specifier.token)) edits.push(removeStatement(source, stmt));
      continue;
    }
    const list = declaratorList(stmt);
    if (!list) continue;
    const quals = (list.specified_type.qualifiers ?? []).map((q) => q.token);
    const declared = list.declarations.map((d) => d.identifier.identifier);
    if (quals.includes('out')) {
      outputs.push(...declared);
      edits.push(removeStatement(source, stmt));
    } else if (quals.includes('uniform') && declared.every((n) => APP_UNIFORMS.has(n))) {
      edits.push(removeStatement(source, stmt));
    } else if (quals.includes('in') || quals.includes('varying')) {
      return { ok: false, reason: `Shadertoy has no varyings like ${declared[0]}. Use fragCoord / iResolution.xy instead.` };
    }
  }

  if (outputs.length > 1) return { ok: false, reason: 'A Shadertoy image has one output, and this shader declares several.' };
  const out = outputs[0] ?? 'fragColor';
  const usedElsewhere = fns.filter((f) => f.name !== 'main').some((f) => identifierNames(f.node).has(out));
  if (outputs.length && usedElsewhere) return { ok: false, reason: `${out} is written outside main(), but in Shadertoy it only exists inside mainImage().` };

  // `vec2 fragCoord = gl_FragCoord.xy;` opening main (what the reverse conversion writes) becomes the parameter again.
  const first = statements(main.node)[0];
  const firstText = first?.type === 'declaration_statement' ? source.slice(span(first).start.offset, statementEnd(first)).trim() : '';
  const reuse = /^vec2\s+([A-Za-z_]\w*)\s*=\s*gl_FragCoord\s*\.\s*xy\s*;$/.exec(firstText);
  const names = identifierNames(ast);
  const coord = reuse?.[1] ?? ['fragCoord', 'pixelCoord', 'sd_coord'].find((n) => !names.has(n))!;
  if (reuse) edits.push(removeStatement(source, first));

  edits.push({ ...headerRange(main.node), text: `mainImage(out vec4 ${out}, in vec2 ${coord})` });
  renameAll(main.node.body as unknown as AstNode, source, edits, (name, sw) =>
    name === 'gl_FragCoord' && firstTwoOnly(sw) ? (sw === 'xy' ? { text: coord, keepSwizzle: false } : coord) : null,
  );
  renameAll(ast, source, edits, (name, sw) => {
    if (name === 'u_time') return 'iTime';
    if (name === 'u_resolution') return firstTwoOnly(sw) ? 'iResolution' : 'iResolution.xy';
    if (name === 'u_mouse') return firstTwoOnly(sw) ? 'iMouse' : 'iMouse.xy';
    return null;
  });
  return { ok: true, code: trimLeadingBlankLines(apply(source, edits)) };
}

export function shadertoyToEs300(ast: Program, source: string): Converted {
  const edits: Edit[] = [];
  const mi = functions(ast).find((f) => f.name === 'mainImage');
  if (!mi) return { ok: false, reason: 'There is no mainImage() to turn into main().' };
  const params = (mi.node.prototype.parameters ?? []) as unknown as { identifier?: { identifier: string } }[];
  const [out, coord] = params.map((p) => p.identifier?.identifier);
  if (params.length !== 2 || !out || !coord) return { ok: false, reason: 'mainImage() should be mainImage(out vec4 fragColor, in vec2 fragCoord).' };

  edits.push({ ...headerRange(mi.node), text: 'main()' });
  const lb = span((mi.node.body as unknown as { lb: unknown }).lb).start.offset + 1;
  const first = statements(mi.node)[0];
  const indent = first ? indentAt(source, span(first).start.offset) : '  ';
  edits.push({ start: lb, end: lb, text: `\n${indent || '  '}vec2 ${coord} = gl_FragCoord.xy;` });

  const names = identifierNames(ast);
  renameAll(ast, source, edits, (name, sw) => {
    if (name === 'iTime') return 'u_time';
    if (name === 'iResolution') return firstTwoOnly(sw) ? (sw === 'xy' ? { text: 'u_resolution', keepSwizzle: false } : 'u_resolution') : 'vec3(u_resolution, 1.0)';
    if (name === 'iMouse') return firstTwoOnly(sw) ? (sw === 'xy' ? { text: 'u_mouse', keepSwizzle: false } : 'u_mouse') : 'vec4(u_mouse, 0.0, 0.0)';
    return null;
  });

  // Declarations Shadertoy made for us: precision, the inputs used, and the output.
  const decls = ['precision highp float;'];
  for (const s of SHADERTOY_UNIFORMS) {
    if (!names.has(s.name)) continue;
    const [base, len] = s.type.split('[');
    decls.push(CANONICAL_DECLS[s.name] ?? `uniform ${base} ${s.name}${len ? `[${len}` : ''};`);
  }
  decls.push(`out vec4 ${out};`);
  for (const stmt of ast.program as AstNode[]) if (isVersion(stmt)) edits.push(removeStatement(source, stmt));
  edits.push({ start: 0, end: 0, text: `${decls.join('\n')}\n\n` });
  return { ok: true, code: apply(source, edits) };
}

function trimLeadingBlankLines(code: string): string {
  return code.replace(/^(?:[ \t]*\n)+/, '');
}
