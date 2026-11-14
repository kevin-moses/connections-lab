import { describe, expect, it } from 'vitest';
import { parseInfoLog } from '../src/glsl/diagnostics';
import { prepareFragmentSource } from '../src/glsl/prepare';

const source = [
  'precision highp float;',      // 1
  'out vec4 fragColor;',         // 2
  'void main() {',               // 3
  '  vec2 uv = foo * 2.0;',      // 4
  '  fragColor = vec4(uv, 0.0);',// 5
  '}',                           // 6
].join('\n');

describe('parseInfoLog', () => {
  const { map } = prepareFragmentSource(source); // injects 1 line

  it('maps ANGLE-style errors back to the learner line and finds the token', () => {
    const log = "ERROR: 0:5: 'foo' : undeclared identifier\nERROR: 0:5: '' : compilation terminated\n2 compilation errors.  No code generated.\n";
    const diags = parseInfoLog(log, map, source);
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ line: 4, message: "undeclared identifier 'foo'", severity: 'error', from: 12, to: 15 });
  });

  it("says how to declare an app uniform the shader uses but didn't declare", () => {
    const src = 'void main() {\n  float t = u_time;\n}';
    const { map: m } = prepareFragmentSource(src);
    const [d] = parseInfoLog("ERROR: 0:3: 'u_time' : undeclared identifier", m, src);
    expect(d.message).toBe("undeclared identifier 'u_time'. The app supplies it, but you have to declare it: add `uniform float u_time;` at the top");
    expect(d).toMatchObject({ line: 2, from: 12, to: 18 });
  });

  it('handles errors without a token', () => {
    const diags = parseInfoLog("ERROR: 0:6: '' : syntax error", map, source);
    expect(diags[0]).toMatchObject({ line: 5, message: 'syntax error' });
    expect(diags[0].from).toBeUndefined();
  });

  it('matches whole words only for identifier tokens', () => {
    const src = 'void main() {\n  float uvx = uv;\n}';
    const { map: m } = prepareFragmentSource(src);
    const [d] = parseInfoLog("ERROR: 0:3: 'uv' : undeclared identifier", m, src);
    expect(d).toMatchObject({ line: 2, from: 14, to: 16 });
  });

  it('finds operator tokens by substring', () => {
    const [d] = parseInfoLog("ERROR: 0:5: '*' : wrong operand types", map, source);
    expect(d).toMatchObject({ line: 4, from: 16, to: 17 });
  });

  it('errors on injected lines have no source line', () => {
    const [d] = parseInfoLog("ERROR: 0:1: 'x' : something", map, source);
    expect(d.line).toBeNull();
  });

  it('keeps unrecognised log lines as unlocated errors and dedupes', () => {
    const diags = parseInfoLog('Something odd\nSomething odd\nWARNING: 0:3: \'\' : extension not supported', map, source);
    expect(diags).toEqual([
      { line: null, message: 'Something odd', severity: 'error', origin: 'gpu' },
      { line: 2, message: 'extension not supported', severity: 'warning', origin: 'gpu' },
    ]);
  });
});
