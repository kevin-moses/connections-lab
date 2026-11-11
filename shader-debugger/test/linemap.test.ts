import { describe, expect, it } from 'vitest';
import { LineMap } from '../src/glsl/linemap';
import { prepareFragmentSource } from '../src/glsl/prepare';

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
    const src = '// hello\n/* block */\n#version 300 es\nvoid main(){}';
    const p = prepareFragmentSource(src);
    expect(p.code).toBe(src);
    expect(p.version).toBe('300 es');
    expect(p.map.toSource(4)).toBe(4);
  });

  it('detects ES 1.00 shaders', () => {
    const p = prepareFragmentSource('#version 100\nvoid main(){ gl_FragColor = vec4(1.0); }');
    expect(p.version).toBe('100');
    expect(p.injectedVersion).toBe(false);
  });

  it('does not treat #version inside a later line as the directive', () => {
    const p = prepareFragmentSource('float x;\n#version 300 es\n');
    expect(p.injectedVersion).toBe(true);
  });
});
