import { describe, expect, it } from 'vitest';
import { parseGlsl } from '../src/glsl/parse';
import { traceFragment } from '../src/interp/interpreter';
import { CORPUS } from '../src/interp/corpus';

describe('self-test corpus runs on the interpreter', () => {
  it.each(CORPUS.map((c) => [c.name, c.source]))('%s', (_name, source) => {
    const parsed = parseGlsl(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const pixel of [[10, 10], [160, 120], [300, 200]] as [number, number][]) {
      const r = traceFragment(parsed.ast, { pixel, uniforms: { u_resolution: [320, 240], u_time: 1.25, u_mouse: [96, 144] } });
      expect(r.error, r.error?.message).toBeNull();
      expect(r.discarded || r.output !== null).toBe(true);
      expect(r.steps.length).toBeGreaterThan(0);
    }
  });
});
