import { parseGlsl } from '../glsl/parse';
import { detectStyle, type GlslStyle } from '../glsl/prepare';
import { es300ToP5, p5ToEs300 } from './p5';
import { es300ToShadertoy, shadertoyToEs300 } from './shadertoy';

export type Converted = { ok: true; code: string } | { ok: false; reason: string };

/**
 * Show code in another style: GLSL ES 3.00, p5 (ES 1.00) or Shadertoy.
 * Everything goes through ES 3.00. Edits come from the parser, so comments
 * and formatting are kept; the code has to parse.
 */
export function convert(source: string, to: GlslStyle): Converted {
  const from = detectStyle(source);
  if (from === to) return { ok: true, code: source };
  const parsed = parseGlsl(source);
  if (!parsed.ok) return { ok: false, reason: `Fix the code so it parses first: ${parsed.diagnostic.message}` };

  let es300 = source;
  let ast = parsed.ast;
  if (from !== 'es300') {
    const r = from === 'es100' ? p5ToEs300(ast, source) : shadertoyToEs300(ast, source);
    if (!r.ok || to === 'es300') return r;
    es300 = r.code;
    const again = parseGlsl(es300);
    if (!again.ok) return { ok: false, reason: `Converting produced code that doesn't parse: ${again.diagnostic.message}` };
    ast = again.ast;
  }
  return to === 'es100' ? es300ToP5(ast, es300) : es300ToShadertoy(ast, es300);
}

/** `convert`, or null when it can't be done. */
export function convertStyle(source: string, to: GlslStyle): string | null {
  const r = convert(source, to);
  return r.ok ? r.code : null;
}
