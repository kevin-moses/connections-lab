import { parser, GlslSyntaxError } from '@shaderfrog/glsl-parser';
import type { Program } from '@shaderfrog/glsl-parser/ast';
import type { ShaderDiagnostic } from './diagnostics';

export type ParseResult =
  | { ok: true; ast: Program; ms: number }
  | { ok: false; diagnostic: ShaderDiagnostic; ms: number };

/**
 * Parse learner source into an AST with locations. Locations refer to the
 * learner's own lines (we parse the source, not the GPU-prepared code).
 */
export function parseGlsl(source: string): ParseResult {
  const t0 = performance.now();
  try {
    const ast = parser.parse(source, {
      includeLocation: true,
      stage: 'fragment',
      quiet: true,
    });
    return { ok: true, ast, ms: performance.now() - t0 };
  } catch (e) {
    const ms = performance.now() - t0;
    const err = e as GlslSyntaxError & { location?: { start: { line: number; column: number } } };
    const loc = err.location?.start;
    return {
      ok: false,
      ms,
      diagnostic: {
        line: loc?.line ?? null,
        from: loc ? loc.column - 1 : undefined,
        message: String(err.message ?? e).split('\n')[0],
        severity: 'error',
        origin: 'parser',
      },
    };
  }
}
