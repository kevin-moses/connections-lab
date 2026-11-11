import { LineMap, countLines } from './linemap';

export type GlslVersion = '300 es' | '100';

export interface PreparedShader {
  /** Code handed to WebGL. */
  code: string;
  /** Generated → source line mapping. */
  map: LineMap;
  version: GlslVersion;
  /** True if the tool added the `#version` line. */
  injectedVersion: boolean;
}

/** Comments and whitespace may precede `#version`; nothing else may. */
const LEADING_TRIVIA = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/;
const VERSION_DIRECTIVE = /^#[ \t]*version[ \t]+(\d+)(?:[ \t]+(es))?/;

/**
 * Turn canonical learner source into something WebGL2 will compile.
 *
 * Canonical source may omit `#version` (we add `#version 300 es`). A learner
 * who writes `#version 100` gets an ES 1.00 shader (p5-style `gl_FragColor`).
 */
export function prepareFragmentSource(source: string): PreparedShader {
  const lines = countLines(source);
  const trivia = LEADING_TRIVIA.exec(source)?.[0] ?? '';
  const match = VERSION_DIRECTIVE.exec(source.slice(trivia.length));

  if (match) {
    const version: GlslVersion = match[1] === '100' ? '100' : '300 es';
    return { code: source, map: LineMap.identity(lines), version, injectedVersion: false };
  }

  return {
    code: `#version 300 es\n${source}`,
    map: LineMap.withPrefix(1, lines),
    version: '300 es',
    injectedVersion: true,
  };
}
