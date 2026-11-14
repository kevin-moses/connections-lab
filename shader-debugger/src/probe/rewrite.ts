import { visit, type Path } from '@shaderfrog/glsl-parser/ast';
import type { AstNode, Program, FunctionNode, KeywordNode } from '@shaderfrog/glsl-parser/ast';
import type { ProbeTarget } from './target';

/**
 * Probe shader layout (MRT, both RGBA32F):
 *   location 0 → captured value as vec4 (unused components = 0)
 *   location 1 → meta: (hits, dim, kind, capturedAtHit)
 *     hits = how many times this pixel reached the probe point (0 = never)
 *     dim  = 1..4 components
 *     kind = 0 float, 1 int, 2 uint, 3 bool
 */
export const PROBE_ITER_UNIFORM = 'u_sd_iter';

export const KIND_NAMES = ['float', 'int', 'uint', 'bool'] as const;

const OVERLOADS: [type: string, dim: number, kind: number, toVec4: string][] = [
  ['float', 1, 0, 'vec4(x, 0.0, 0.0, 0.0)'],
  ['vec2', 2, 0, 'vec4(x, 0.0, 0.0)'],
  ['vec3', 3, 0, 'vec4(x, 0.0)'],
  ['vec4', 4, 0, 'x'],
  ['int', 1, 1, 'vec4(float(x), 0.0, 0.0, 0.0)'],
  ['ivec2', 2, 1, 'vec4(vec2(x), 0.0, 0.0)'],
  ['ivec3', 3, 1, 'vec4(vec3(x), 0.0)'],
  ['ivec4', 4, 1, 'vec4(x)'],
  ['uint', 1, 2, 'vec4(float(x), 0.0, 0.0, 0.0)'],
  ['uvec2', 2, 2, 'vec4(vec2(x), 0.0, 0.0)'],
  ['uvec3', 3, 2, 'vec4(vec3(x), 0.0)'],
  ['uvec4', 4, 2, 'vec4(x)'],
  ['bool', 1, 3, 'vec4(x ? 1.0 : 0.0, 0.0, 0.0, 0.0)'],
  ['bvec2', 2, 3, 'vec4(vec2(x), 0.0, 0.0)'],
  ['bvec3', 3, 3, 'vec4(vec3(x), 0.0)'],
  ['bvec4', 4, 3, 'vec4(x)'],
];

/**
 * Helpers injected before the first function. Kept on ONE line so the
 * learner's line numbers don't move (GPU errors still map 1:1).
 */
const PREAMBLE = [
  `uniform highp float ${PROBE_ITER_UNIFORM};`,
  'highp vec4 _sd_value = vec4(0.0);',
  'highp float _sd_hits = 0.0;',
  'highp float _sd_at = 0.0;',
  'highp float _sd_dim = 0.0;',
  'highp float _sd_kind = 0.0;',
  ...OVERLOADS.map(
    ([type, dim, kind, conv]) =>
      `highp vec4 _sd_v(${type} x) { _sd_dim = ${dim}.0; _sd_kind = ${kind}.0; return ${conv}; }`,
  ),
  `void _sd_capture(highp vec4 v) { _sd_hits += 1.0; if (${PROBE_ITER_UNIFORM} < 0.5 || _sd_hits == ${PROBE_ITER_UNIFORM}) { _sd_value = v; _sd_at = _sd_hits; } }`,
].join(' ');

/** The probe's `main`: runs the learner's entry point, then writes the capture. */
const epilogue = (call: string) => `
layout(location = 0) out highp vec4 _sd_out_value;
layout(location = 1) out highp vec4 _sd_out_meta;
void main() {
  ${call}
  _sd_out_value = _sd_value;
  _sd_out_meta = vec4(_sd_hits, _sd_dim, _sd_kind, _sd_at);
}
`;
/** A Shadertoy shader has no `main`: call its `mainImage` the way Shadertoy does. */
const MAIN_IMAGE_CALL = 'highp vec4 _sd_color = vec4(0.0); mainImage(_sd_color, gl_FragCoord.xy);';

export type ProbeShaderResult = { ok: true; code: string } | { ok: false; reason: string };

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Rewrite learner source into a probe shader that outputs `target.expr`
 * (captured after the target statement) instead of a color.
 *
 * Edits never add or remove newlines inside the learner's code, so line
 * numbers in GPU errors still match the editor.
 */
export function buildProbeShader(ast: Program, source: string, target: ProbeTarget): ProbeShaderResult {
  const edits: Edit[] = [];
  let mainFound = false;
  let mainImageFound = false;
  let firstFunctionStart: number | null = null;

  for (const stmt of ast.program as AstNode[]) {
    if (stmt.type === 'function') {
      const fn = stmt as FunctionNode;
      firstFunctionStart ??= fn.location!.start.offset;
      const name = fn.prototype.header.name;
      if (name.identifier === 'mainImage') mainImageFound = true;
      if (name.identifier === 'main') {
        mainFound = true;
        const start = name.location!.start.offset;
        edits.push({ start, end: start + 4, text: '_sd_main' });
      }
    }
    // Global `out` declarations become plain globals: the learner's main still
    // writes them, but our outputs replace theirs.
    if (stmt.type === 'declaration_statement') {
      visit(stmt, {
        keyword: {
          enter: (p: Path<KeywordNode>) => {
            if (p.key !== 'qualifiers' || p.node.token !== 'out') return;
            const start = p.node.location!.start.offset;
            edits.push({ start, end: start + 3, text: '   ' });
          },
        },
        layout_qualifier: {
          enter: (p: Path<AstNode>) => {
            const loc = p.node.location!;
            const raw = source.slice(loc.start.offset, loc.end.offset);
            const end = loc.start.offset + raw.trimEnd().length;
            edits.push({ start: loc.start.offset, end, text: ' '.repeat(end - loc.start.offset).replace(/[^\n]/g, ' ') });
          },
        },
      });
    }
  }

  if (!mainFound && !mainImageFound) return { ok: false, reason: 'No main() function (or Shadertoy mainImage()) found.' };
  if (firstFunctionStart === null) return { ok: false, reason: 'No functions found.' };

  edits.push({ start: firstFunctionStart, end: firstFunctionStart, text: `${PREAMBLE} ` });

  const capture = (expr: string) => `_sd_capture(_sd_v(${expr}));`;
  const ins = target.insert;
  switch (ins.kind) {
    case 'after':
      edits.push({ start: ins.offset, end: ins.offset, text: ` ${capture(target.expr)}` });
      break;
    case 'wrap':
      edits.push({ start: ins.start, end: ins.start, text: '{ ' });
      edits.push({ start: ins.end, end: ins.end, text: ` ${capture(target.expr)} }` });
      break;
    case 'return':
      // `return E;` → `{ capture(E); return E; }`  (E is pure in practice)
      edits.push({ start: ins.start, end: ins.start, text: `{ ${capture(target.expr)} ` });
      edits.push({ start: ins.end, end: ins.end, text: ' }' });
      break;
  }

  return { ok: true, code: applyEdits(source, edits) + epilogue(mainFound ? '_sd_main();' : MAIN_IMAGE_CALL) };
}

function applyEdits(source: string, edits: Edit[]): string {
  // Apply right-to-left so earlier offsets stay valid. Insertions at the same
  // offset keep their push order.
  const ordered = edits
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => b.start - a.start || b.i - a.i);
  let out = source;
  for (const e of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
