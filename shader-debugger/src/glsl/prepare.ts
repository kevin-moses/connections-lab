import { LineMap, countLines } from './linemap';
import { SHADERTOY_HEADER, isShadertoy } from './shadertoy';

/**
 * How the learner wrote it: modern GLSL ES 3.00; ES 1.00 as in p5 and most
 * tutorials; or a Shadertoy image shader (`mainImage`, `iTime`, ...).
 */
export type GlslStyle = 'es300' | 'es100' | 'shadertoy';

export interface PreparedShader {
  /** GLSL ES 3.00 code handed to WebGL. */
  code: string;
  /** Generated → source line mapping. */
  map: LineMap;
  style: GlslStyle;
  /** True if the tool added a `#version` line. */
  injectedVersion: boolean;
}

export interface PrepareOptions {
  /**
   * The shader declares its own outputs and `main` (the probe rewriter's MRT
   * epilogue), so an ES 1.00 `gl_FragColor` becomes a plain global instead of
   * output 0, and a Shadertoy shader gets no `main` wrapper.
   */
  ownOutputs?: boolean;
  /**
   * The style of the learner's code, when the source has been rewritten
   * (a probe shader declares outputs, which would read as ES 3.00).
   */
  style?: GlslStyle;
}

/** What an ES 1.00 `gl_FragColor` is called in the generated ES 3.00 code. */
export const FRAG_COLOR_OUT = 'sd_FragColor';

/** Comments and whitespace may precede `#version`; nothing else may. */
const LEADING_TRIVIA = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/;
const VERSION_DIRECTIVE = /^#[ \t]*version[ \t]+(\d+)(?:[ \t]+(es))?[^\n]*/;

/** ES 1.00 names that ES 3.00 spells differently (the same set three.js maps for ShaderMaterial). */
const ES100_DEFINES = [
  '#define varying in',
  '#define texture2D texture',
  '#define textureCube texture',
  '#define texture2DProj textureProj',
  `#define gl_FragColor ${FRAG_COLOR_OUT}`,
];

const ES100_MARKERS = /\b(?:gl_FragColor|gl_FragData|varying|attribute|texture2D|textureCube)\b/;
// A global output: `out vec4 c;` or `layout(location = 0) out ...` at the start of a line.
const GLOBAL_OUT = /^[ \t]*(?:layout[ \t]*\([^)]*\)[ \t]*)?out[ \t]+\w/m;

/**
 * Which style the code is written in, from the code itself: Shadertoy defines
 * `mainImage` instead of `main`, ES 3.00 must declare an `out`, and ES 1.00
 * writes `gl_FragColor`, so they don't overlap. Code with none of these is
 * treated as ES 3.00.
 */
export function detectStyle(source: string): GlslStyle {
  const trivia = LEADING_TRIVIA.exec(source)?.[0] ?? '';
  const version = VERSION_DIRECTIVE.exec(source.slice(trivia.length));
  if (version) return version[1] === '100' ? 'es100' : 'es300';
  const code = stripComments(source);
  if (isShadertoy(code)) return 'shadertoy';
  return !GLOBAL_OUT.test(code) && ES100_MARKERS.test(code) ? 'es100' : 'es300';
}

/**
 * Turn the learner's source into GLSL ES 3.00 that WebGL2 will compile.
 *
 * ES 3.00 source may omit `#version` (we add it). ES 1.00 source (p5 style)
 * is converted the way three.js converts ShaderMaterial code: `#define`s for
 * the renamed built-ins and one output declaration, inserted on lines of
 * their own and mapped back so errors land on the learner's lines. A missing
 * `precision` (common in code written for three.js, which adds it) is added.
 */
export function prepareFragmentSource(source: string, options: PrepareOptions = {}): PreparedShader {
  const srcLines = source.split('\n');
  const lines = countLines(source);
  const trivia = LEADING_TRIVIA.exec(source)?.[0] ?? '';
  const version = VERSION_DIRECTIVE.exec(source.slice(trivia.length));
  const style = options.style ?? detectStyle(source);

  if (style === 'shadertoy') return prepareShadertoy(source, lines, options);
  // three.js adds `precision` itself, so code written for it often has none.
  const needsPrecision = !/\bprecision\s+\w+\s+float\s*;/.test(stripComments(source));
  if (style === 'es300' && !needsPrecision) {
    if (version) return { code: source, map: LineMap.identity(lines), style, injectedVersion: false };
    return { code: `#version 300 es\n${source}`, map: LineMap.withPrefix(1, lines), style, injectedVersion: true };
  }

  const out: string[] = [];
  const genToSrc: (number | null)[] = [];
  const emit = (text: string, src: number | null) => {
    out.push(text);
    genToSrc.push(src);
  };

  // `#version 100` is replaced on its own line; without one we add a line.
  const versionLine = version ? countLines(trivia) : 0; // 1-based line of the directive, or 0
  let next = 1;
  if (versionLine) {
    for (; next < versionLine; next++) emit(srcLines[next - 1], next);
    emit(srcLines[versionLine - 1].replace(VERSION_DIRECTIVE, '#version 300 es'), versionLine);
    next = versionLine + 1;
  } else {
    emit('#version 300 es', null);
  }
  if (style === 'es100') for (const d of ES100_DEFINES) emit(d, null);

  // Declarations, and `#extension` lines must come before any code, so these
  // go just above the first line of code.
  const before: string[] = [];
  if (needsPrecision) before.push('precision highp float;');
  if (style === 'es100') before.push(options.ownOutputs ? `highp vec4 ${FRAG_COLOR_OUT};` : `layout(location = 0) out highp vec4 ${FRAG_COLOR_OUT};`);
  const codeLine = firstCodeLine(srcLines, next);
  for (let n = next; n <= lines; n++) {
    if (n === codeLine) for (const d of before) emit(d, null);
    emit(srcLines[n - 1], n);
  }
  if (codeLine === null) for (const d of before) emit(d, null);

  return { code: out.join('\n'), map: new LineMap(genToSrc), style, injectedVersion: !versionLine };
}

/**
 * Wrap a Shadertoy image shader the way shadertoy.com does: its inputs in
 * front (one line), and a `main` that calls `mainImage` with the pixel's
 * position. As on Shadertoy, the image is opaque: alpha is forced to 1.
 */
function prepareShadertoy(source: string, lines: number, options: PrepareOptions): PreparedShader {
  const prefix = ['#version 300 es', SHADERTOY_HEADER];
  const suffix = options.ownOutputs
    ? []
    : [
        `layout(location = 0) out highp vec4 ${FRAG_COLOR_OUT};`,
        `void main() { vec4 c = vec4(0.0, 0.0, 0.0, 1.0); mainImage(c, gl_FragCoord.xy); ${FRAG_COLOR_OUT} = vec4(c.rgb, 1.0); }`,
      ];
  const map = new LineMap([...prefix.map(() => null), ...Array.from({ length: lines }, (_, i) => i + 1), ...suffix.map(() => null)]);
  return { code: [...prefix, source, ...suffix].join('\n'), map, style: 'shadertoy', injectedVersion: true };
}

/** First line (from `from`) with code on it: not blank, a comment, or a directive. */
function firstCodeLine(lines: string[], from: number): number | null {
  const code = stripComments(lines.join('\n')).split('\n');
  for (let n = from; n <= code.length; n++) {
    const t = code[n - 1].trim();
    if (t && !t.startsWith('#')) return n;
  }
  return null;
}

/** Blank out comments, keeping every newline (so line numbers still match). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}
