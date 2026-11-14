import { describe, expect, it } from 'vitest';
import { parseGlsl } from '../src/glsl/parse';
import { resolveProbeTarget } from '../src/probe/target';
import { buildProbeShader } from '../src/probe/rewrite';

const SRC = `precision highp float;
uniform vec2 u_resolution;
layout(location = 0) out vec4 fragColor;

float rect(vec2 uv, vec2 lo, vec2 hi) {
  vec2 s = step(lo, uv) * (1.0 - step(hi, uv));
  return s.x * s.y;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;   // note
  uv.x *= 2.0;
  float d = length(uv - 0.5);
  if (d > 0.3) d = 0.0;
  for (int i = 0; i < 3; i++) {
    d += 0.1;
  }
  vec3 col = vec3(d);
  col *= rect(uv, vec2(0.2), vec2(0.8));
  fragColor = vec4(col, 1.0);
}
`;

const lines = SRC.split('\n');
/** Offset of `needle` on 1-based `line`, plus `delta`. */
function at(line: number, needle: string, delta = 0): number {
  const before = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
  const col = lines[line - 1].indexOf(needle);
  if (col < 0) throw new Error(`"${needle}" not on line ${line}`);
  return before + col + delta;
}

function ast() {
  const r = parseGlsl(SRC);
  if (!r.ok) throw new Error(r.diagnostic.message);
  return r.ast;
}

function target(line: number, needle: string, delta = 0) {
  return resolveProbeTarget(ast(), SRC, at(line, needle, delta));
}

describe('resolveProbeTarget', () => {
  it('defaults to the declared variable', () => {
    const t = target(11, 'vec2');
    expect(t).toMatchObject({ expr: 'uv', line: 11, functionName: 'main', insert: { kind: 'after' } });
  });

  it('works with the cursor in indentation or after a trailing comment', () => {
    expect(target(11, '  vec2', 0)?.expr).toBe('uv');
    expect(target(11, '// note', 7)?.expr).toBe('uv');
  });

  it('defaults to the assigned variable for compound assignment with swizzle', () => {
    expect(target(12, 'uv.x')?.expr).toBe('uv');
  });

  it('probes the identifier under the cursor', () => {
    expect(target(13, 'length', 0)?.expr).toBe('d'); // function name → default
    expect(target(13, 'uv - ', 1)?.expr).toBe('uv');
  });

  it('probes the whole variable on its name, the swizzle on the swizzle', () => {
    expect(target(11, 'gl_FragCoord', 2)?.expr).toBe('gl_FragCoord');
    expect(target(11, '.xy', 2)?.expr).toBe('gl_FragCoord.xy');
    expect(target(12, 'uv.x', 3)?.expr).toBe('uv.x');
  });

  it('wraps braceless if bodies', () => {
    expect(target(14, 'd = 0.0')).toMatchObject({ expr: 'd', insert: { kind: 'wrap' } });
  });

  it('probes inside loop bodies', () => {
    expect(target(16, 'd +=')).toMatchObject({ expr: 'd', insert: { kind: 'after' }, line: 16 });
  });

  it('ignores loop headers, blank lines and globals', () => {
    expect(target(15, 'for')).toBeNull();
    expect(resolveProbeTarget(ast(), SRC, at(9, '', 0))).toBeNull();
    expect(target(2, 'u_resolution')).toBeNull();
  });

  it('probes return values, or a variable inside the return', () => {
    expect(target(7, 'return')).toMatchObject({ expr: 's.x * s.y', label: 'rect() returns', functionName: 'rect', insert: { kind: 'return' } });
    expect(target(7, 's.y', 2)?.expr).toBe('s.y');
  });
});

describe('buildProbeShader', () => {
  const cases: [number, string][] = [
    [11, 'vec2'],
    [12, 'uv.x'],
    [14, 'd = 0.0'],
    [16, 'd +='],
    [7, 'return'],
    [11, '.xy'],
  ];

  it.each(cases)('line %i (%s) produces a parseable shader with unchanged line numbers', (line, needle) => {
    const t = target(line, needle)!;
    const r = buildProbeShader(ast(), SRC, t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = parseGlsl(r.code);
    expect(parsed.ok, parsed.ok ? '' : parsed.diagnostic.message).toBe(true);

    const outLines = r.code.split('\n');
    // Every learner line keeps its number; only the epilogue is appended.
    for (let i = 0; i < lines.length; i++) {
      if (i + 1 === line || i + 1 === 5 || i + 1 === 10) continue; // edited lines
      if (i + 1 === 3) continue; // layout/out blanked
      expect(outLines[i]).toBe(lines[i]);
    }
    expect(outLines[line - 1]).toContain(`_sd_capture(_sd_v(${t.expr}))`);
  });

  it('renames main, strips out/layout from the output, and appends MRT outputs', () => {
    const r = buildProbeShader(ast(), SRC, target(11, 'vec2')!);
    if (!r.ok) throw new Error(r.reason);
    const out = r.code.split('\n');
    expect(out[2].trim()).toBe('vec4 fragColor;');
    expect(out[9]).toContain('void _sd_main()');
    expect(r.code).toContain('layout(location = 1) out highp vec4 _sd_out_meta;');
    expect(out[4].startsWith('uniform highp float u_sd_iter;')).toBe(true);
  });

  it('probes ES 1.00 (p5-style) shaders too: gl_FragColor stays a global the epilogue ignores', () => {
    const src = 'precision mediump float;\nvarying vec2 vTexCoord;\nvoid main(){ float a = vTexCoord.x; gl_FragColor = vec4(a); }\n';
    const r = parseGlsl(src);
    if (!r.ok) throw new Error(r.diagnostic.message);
    const t = resolveProbeTarget(r.ast, src, src.indexOf('float a'))!;
    const built = buildProbeShader(r.ast, src, t);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.code).toContain('void _sd_main()');
    expect(built.code).toContain('_sd_capture(_sd_v(a));');
    expect(built.code.split('\n').length).toBeGreaterThanOrEqual(src.split('\n').length);
  });
});
