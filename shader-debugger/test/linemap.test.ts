import { describe, expect, it } from 'vitest';
import { LineMap } from '../src/glsl/linemap';
import { detectStyle, prepareFragmentSource } from '../src/glsl/prepare';

describe('LineMap', () => {
  it('identity maps every line to itself', () => {
    const m = LineMap.identity(3);
    expect([1, 2, 3].map((l) => m.toSource(l))).toEqual([1, 2, 3]);
    expect(m.toSource(4)).toBeNull();
  });

  it('prefix lines map to null and shift the rest', () => {
    const m = LineMap.withPrefix(2, 3);
    expect(m.toSource(1)).toBeNull();
    expect(m.toSource(2)).toBeNull();
    expect(m.toSource(3)).toBe(1);
    expect(m.toSource(5)).toBe(3);
    expect(m.toGenerated(1)).toBe(3);
  });
});

describe('prepareFragmentSource', () => {
  it('injects #version 300 es when missing and offsets lines by one', () => {
    const p = prepareFragmentSource('precision highp float;\nout vec4 c;\nvoid main(){}');
    expect(p.code.startsWith('#version 300 es\n')).toBe(true);
    expect(p.injectedVersion).toBe(true);
    expect(p.map.toSource(2)).toBe(1);
  });

  it('keeps an explicit #version, even after comments', () => {
    const src = '// hello\n/* block */\n#version 300 es\nprecision highp float;\nvoid main(){}';
    const p = prepareFragmentSource(src);
    expect(p.code).toBe(src);
    expect(p.style).toBe('es300');
    expect(p.map.toSource(4)).toBe(4);
  });

  it('adds a missing precision just above the first line of code (three.js code leaves it out)', () => {
    const src = '#version 300 es\n// three.js adds precision\nuniform float u_time;\nout vec4 c;\nvoid main() { c = vec4(u_time); }';
    const p = prepareFragmentSource(src);
    const gen = p.code.split('\n');
    expect(gen[2]).toBe('precision highp float;');
    expect(gen[3]).toBe('uniform float u_time;');
    expect(p.map.toSource(3)).toBeNull();
    expect(p.map.toSource(4)).toBe(3);
    // A p5/three-style ES 1.00 shader without one gets it too.
    expect(prepareFragmentSource('varying vec2 vUv;\nvoid main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }').code).toContain('\nprecision highp float;\n');
  });

  it('converts an explicit #version 100 in place, keeping lines mapped', () => {
    const src = '#version 100\nprecision highp float;\nvoid main(){ gl_FragColor = vec4(1.0); }';
    const p = prepareFragmentSource(src);
    expect(p.style).toBe('es100');
    expect(p.injectedVersion).toBe(false);
    const gen = p.code.split('\n');
    expect(gen[0]).toBe('#version 300 es');
    expect(p.map.toSource(1)).toBe(1);
    // Every other learner line is still there, and maps back to itself.
    src.split('\n').slice(1).forEach((line, i) => expect(gen[p.map.toGenerated(i + 2)! - 1]).toBe(line));
  });

  it('converts p5-style ES 1.00 code: defines, then the output just above the first line of code', () => {
    const src = [
      '#extension GL_OES_standard_derivatives : enable',
      'precision mediump float;',
      'varying vec2 vTexCoord;',
      '// float fake(vec2 p) {',
      'void main() {',
      '  gl_FragColor = vec4(vTexCoord, 0.0, 1.0);',
      '}',
    ].join('\n');
    const p = prepareFragmentSource(src);
    expect(p.style).toBe('es100');
    const gen = p.code.split('\n');
    expect(gen[0]).toBe('#version 300 es');
    expect(gen).toContain('#define gl_FragColor sd_FragColor');
    const out = gen.indexOf('layout(location = 0) out highp vec4 sd_FragColor;');
    expect(gen[out + 1]).toBe('precision mediump float;');
    expect(gen.indexOf('#extension GL_OES_standard_derivatives : enable')).toBeLessThan(out);
    expect(p.map.toSource(out + 1)).toBeNull();
    expect(p.map.toSource(out + 2)).toBe(2);
    src.split('\n').forEach((line, i) => expect(gen[p.map.toGenerated(i + 1)! - 1]).toBe(line));
  });

  it('makes gl_FragColor a plain global when the shader brings its own outputs (probes)', () => {
    // The probe epilogue declares outputs, so the learner's style is passed in.
    const probe = 'void _sd_main() { gl_FragColor = vec4(1.0); }\nlayout(location = 0) out highp vec4 _sd_out_value;';
    const p = prepareFragmentSource(probe, { ownOutputs: true, style: 'es100' });
    expect(p.code).toContain('\nhighp vec4 sd_FragColor;\n');
    expect(p.code).not.toContain('out highp vec4 sd_FragColor');
  });

  it('tells the styles apart from the code', () => {
    expect(detectStyle('out vec4 c;\nvoid main() { c = vec4(1.0); }')).toBe('es300');
    expect(detectStyle('layout(location = 0) out vec4 c;')).toBe('es300');
    expect(detectStyle('void main() { gl_FragColor = vec4(1.0); }')).toBe('es100');
    expect(detectStyle('varying vec2 v;\nvoid main() {}')).toBe('es100');
    expect(detectStyle('// gl_FragColor in a comment\nout vec4 c;')).toBe('es300');
    expect(detectStyle('void main() {}')).toBe('es300');
    expect(detectStyle('#version 300 es\nvoid main() { gl_FragColor; }')).toBe('es300');
  });

  it('does not treat #version inside a later line as the directive', () => {
    const p = prepareFragmentSource('float x;\n#version 300 es\n');
    expect(p.injectedVersion).toBe(true);
  });
});
