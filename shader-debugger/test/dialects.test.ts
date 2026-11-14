import { describe, expect, it } from 'vitest';
import { convert, convertStyle } from '../src/dialects/convert';
import { detectStyle } from '../src/glsl/prepare';
import { LESSONS } from '../src/lessons/content';
import { checkExercise } from '../src/lessons/checker';
import { cpuRenderer } from '../src/lessons/cpuRender';

const exercises = LESSONS.flatMap((l) => l.exercises);

describe('p5 style conversion', () => {
  it('converts outputs, varyings, texture calls and #version, and nothing else', () => {
    const es300 = [
      '#version 300 es',
      'precision highp float;',
      'in vec2 vTexCoord;',
      'uniform sampler2D tex;',
      'out vec4 fragColor; // the pixel',
      'float f(in float x) { return x; } // fragColor here stays',
      'void main() {',
      '  vec4 c = texture(tex, vTexCoord);',
      '  float fragColorish = 1.0;',
      '  fragColor = vec4(c.rgb * fragColorish, 1.0);',
      '}',
    ].join('\n');
    const p5 = convertStyle(es300, 'es100')!;
    expect(p5).toBe(
      [
        'precision highp float;',
        'varying vec2 vTexCoord;',
        'uniform sampler2D tex;',
        'float f(in float x) { return x; } // fragColor here stays',
        'void main() {',
        '  vec4 c = texture2D(tex, vTexCoord);',
        '  float fragColorish = 1.0;',
        '  gl_FragColor = vec4(c.rgb * fragColorish, 1.0);',
        '}',
      ].join('\n'),
    );
    const back = convertStyle(p5, 'es300')!;
    expect(back).toBe(
      [
        'precision highp float;',
        'out vec4 fragColor;',
        'in vec2 vTexCoord;',
        'uniform sampler2D tex;',
        'float f(in float x) { return x; } // fragColor here stays',
        'void main() {',
        '  vec4 c = texture(tex, vTexCoord);',
        '  float fragColorish = 1.0;',
        '  fragColor = vec4(c.rgb * fragColorish, 1.0);',
        '}',
      ].join('\n'),
    );
  });

  it('picks an unused name for the output', () => {
    const p5 = 'precision mediump float;\nfloat fragColor = 1.0;\nvoid main() { gl_FragColor = vec4(fragColor); }';
    expect(convertStyle(p5, 'es300')).toContain('out vec4 outColor;');
    expect(convertStyle(p5, 'es300')).toContain('outColor = vec4(fragColor);');
  });

  it('leaves code that is already in the target style alone, and refuses what it cannot parse', () => {
    const p5 = 'void main() { gl_FragColor = vec4(1.0); }';
    expect(convertStyle(p5, 'es100')).toBe(p5);
    expect(convertStyle('void main() { gl_FragColor = vec4(1.0) }', 'es300')).toBeNull();
  });

  describe.each(exercises.map((e) => [e.id, e] as const))('%s', (_id, ex) => {
    it('reference still passes in p5 style, and the conversion is stable', () => {
      const p5 = convertStyle(ex.reference, 'es100')!;
      expect(p5).not.toBeNull();
      expect(detectStyle(p5)).toBe('es100');
      expect(p5).not.toMatch(/\bfragColor\b|\bout vec4\b/);
      const failed = checkExercise(ex, p5, cpuRenderer).items.filter((i) => !i.passed);
      expect(failed.map((i) => `${i.label}: ${i.detail}`)).toEqual([]);
      expect(convertStyle(convertStyle(p5, 'es300')!, 'es100')).toBe(p5);
    });

    it('starter converts too', () => {
      expect(detectStyle(convertStyle(ex.starter, 'es100')!)).toBe('es100');
    });

    it('reference still passes as a Shadertoy shader, and the conversion is stable', () => {
      const toy = convertStyle(ex.reference, 'shadertoy')!;
      expect(toy).not.toBeNull();
      expect(detectStyle(toy)).toBe('shadertoy');
      expect(toy).not.toMatch(/\bu_(?:resolution|time|mouse)\b|\bvoid main\(/);
      const failed = checkExercise(ex, toy, cpuRenderer).items.filter((i) => !i.passed);
      expect(failed.map((i) => `${i.label}: ${i.detail}`)).toEqual([]);
      expect(convertStyle(convertStyle(toy, 'es300')!, 'shadertoy')).toBe(toy);
      // p5 and Shadertoy convert into each other too.
      expect(convertStyle(convertStyle(toy, 'es100')!, 'shadertoy')).toBe(toy);
    });
  });

  describe('Shadertoy', () => {
    // Shadertoy's "new shader" template.
    const template = [
      'void mainImage( out vec4 fragColor, in vec2 fragCoord )',
      '{',
      '    // Normalized pixel coordinates (from 0 to 1)',
      '    vec2 uv = fragCoord/iResolution.xy;',
      '',
      '    // Time varying pixel color',
      '    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));',
      '',
      '    // Output to screen',
      '    fragColor = vec4(col,1.0);',
      '}',
    ].join('\n');

    it('unwraps mainImage into main with the app uniforms', () => {
      expect(detectStyle(template)).toBe('shadertoy');
      expect(convertStyle(template, 'es300')).toBe(
        [
          'precision highp float;',
          'uniform vec2 u_resolution;  // canvas size in pixels',
          'uniform float u_time;        // seconds since start',
          'out vec4 fragColor;',
          '',
          'void main()',
          '{',
          '    vec2 fragCoord = gl_FragCoord.xy;',
          '    // Normalized pixel coordinates (from 0 to 1)',
          '    vec2 uv = fragCoord/u_resolution;',
          '',
          '    // Time varying pixel color',
          '    vec3 col = 0.5 + 0.5*cos(u_time+uv.xyx+vec3(0,2,4));',
          '',
          '    // Output to screen',
          '    fragColor = vec4(col,1.0);',
          '}',
        ].join('\n'),
      );
      const toy = convertStyle(convertStyle(template, 'es300')!, 'shadertoy')!;
      expect(toy).toBe(template.replace('mainImage( out vec4 fragColor, in vec2 fragCoord )', 'mainImage(out vec4 fragColor, in vec2 fragCoord)'));
    });

    it('maps the inputs by how they are used', () => {
      const toy = 'void mainImage(out vec4 O, vec2 U) { float a = iResolution.x + iResolution.z + iMouse.y; vec4 m = iMouse; O = vec4(a, float(iFrame), m.x, 1.0); }';
      const es = convertStyle(toy, 'es300')!;
      expect(es).toContain('float a = u_resolution.x + vec3(u_resolution, 1.0).z + u_mouse.y;');
      expect(es).toContain('vec4 m = vec4(u_mouse, 0.0, 0.0);');
      expect(es).toContain('uniform int iFrame;');
      expect(es).toContain('out vec4 O;');
      const back = 'precision highp float;\nuniform vec2 u_resolution;\nout vec4 c;\nvoid main() { vec2 p = gl_FragCoord.xy / u_resolution; float w = u_resolution.x; c = vec4(p, gl_FragCoord.x, 1.0); }';
      expect(convertStyle(back, 'shadertoy')).toBe('void mainImage(out vec4 c, in vec2 fragCoord) { vec2 p = fragCoord / iResolution.xy; float w = iResolution.x; c = vec4(p, fragCoord.x, 1.0); }');
    });

    it('explains what it cannot convert', () => {
      const r = convert('in vec2 vTexCoord;\nout vec4 c;\nvoid main() { c = vec4(vTexCoord, 0.0, 1.0); }', 'shadertoy');
      expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/no varyings like vTexCoord/) });
      expect(convert('void main() { gl_FragColor = vec4(1.0) }', 'shadertoy')).toMatchObject({ ok: false, reason: expect.stringMatching(/parses/) });
    });
  });
});
