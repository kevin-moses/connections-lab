import { parseGlsl } from '../glsl/parse';
import { traceFragment } from '../interp/interpreter';
import type { Renderer } from './checker';

/**
 * Render a shader on the CPU with the interpreter: slow, but runs anywhere
 * (unit tests). Matches the GPU: clamp, round to bytes, discarded = clear.
 */
export const cpuRenderer: Renderer = ({ source, width, height, time, mouse }) => {
  const parsed = parseGlsl(source);
  if (!parsed.ok) return { ok: false, error: parsed.diagnostic.message };
  const data = new Uint8ClampedArray(width * height * 4);
  const uniforms = { u_resolution: [width, height], u_time: time, u_mouse: mouse };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = traceFragment(parsed.ast, { pixel: [x, y], uniforms }, { record: false });
      if (r.error) return { ok: false, error: `${r.error.message}${r.error.line ? ` (line ${r.error.line})` : ''}` };
      if (r.discarded || !r.output) continue;
      const o = (y * width + x) * 4;
      r.output.value.data.forEach((v, c) => (data[o + c] = Math.round(Math.min(1, Math.max(0, v)) * 255)));
    }
  }
  return { ok: true, image: { width, height, data } };
};
