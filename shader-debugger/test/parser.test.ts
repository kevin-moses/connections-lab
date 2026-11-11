/**
 * Locks in what the M0 parser spike established about @shaderfrog/glsl-parser.
 * If a parser upgrade breaks one of these, the debugger (M1/M2) breaks too.
 */
import { describe, expect, it } from 'vitest';
import { generate } from '@shaderfrog/glsl-parser';
import { visit } from '@shaderfrog/glsl-parser/ast';
import { parseGlsl } from '../src/glsl/parse';
import { DEFAULT_SHADER } from '../src/defaultShader';

const ES3 = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
out vec4 fragColor;

float rect(vec2 uv, vec2 lo, vec2 hi) {
  vec2 s = step(lo, uv) * (1.0 - step(hi, uv));
  return s.x * s.y;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;
  float d = length(uv - 0.5);
  for (int i = 0; i < 3; i++) { d += 0.01 * float(i); }
  vec3 col = d > 0.3 ? vec3(uv, 0.0) : vec3(1.0);
  col.rg = col.gr;
  fragColor = vec4(col * rect(uv, vec2(0.2), vec2(0.8)), 1.0);
}
`;

function mustParse(src: string) {
  const r = parseGlsl(src);
  if (!r.ok) throw new Error(r.diagnostic.message);
  return r.ast;
}

describe('glsl parser capabilities', () => {
  it('round-trips ES 3.00, ES 1.00 (p5) and Shadertoy sources byte-for-byte', () => {
    const es1 = 'precision mediump float;\nvarying vec2 vTexCoord;\nuniform sampler2D tex0;\nvoid main(){ gl_FragColor = texture2D(tex0, vTexCoord); }\n';
    const toy = 'void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = vec4(fragCoord/iResolution.xy, 0.5+0.5*sin(iTime), 1.0); }\n';
    for (const src of [ES3, es1, toy, DEFAULT_SHADER]) expect(generate(mustParse(src))).toBe(src);
  });

  it('attaches locations to statements and identifiers', () => {
    const ast = mustParse(ES3);
    let missing = 0;
    let identifiers = 0;
    const check = (p: { node: { location?: unknown } }) => { if (!p.node.location) missing++; };
    visit(ast, {
      declaration_statement: { enter: check },
      expression_statement: { enter: check },
      identifier: { enter: (p) => { identifiers++; check(p); } },
    });
    expect(identifiers).toBeGreaterThan(20);
    expect(missing).toBe(0);
  });

  it('reports the for-loop on the right line', () => {
    const ast = mustParse(ES3);
    let line = 0;
    visit(ast, { for_statement: { enter: (p) => { line = p.node.location!.start.line; } } });
    expect(line).toBe(15);
  });

  it('tracks scopes and function bindings', () => {
    const ast = mustParse(ES3);
    expect(ast.scopes.map((s) => s.name)).toEqual(['global', 'rect', 'main', 'for']);
    const main = ast.scopes.find((s) => s.name === 'main')!;
    expect(Object.keys(main.bindings)).toEqual(expect.arrayContaining(['uv', 'd', 'col']));
    expect(Object.keys(ast.scopes[0].functions)).toEqual(['rect', 'main']);
  });

  it('returns a located diagnostic on syntax errors', () => {
    const r = parseGlsl('void main() {\n  float x = 1.0\n  x += 2.0;\n}\n');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostic.origin).toBe('parser');
      expect(r.diagnostic.line).toBe(3);
      expect(r.diagnostic.from).toBe(2);
    }
  });
});
