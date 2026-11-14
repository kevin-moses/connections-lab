/**
 * Shadertoy's inputs, derived from the app's three (u_resolution, u_time,
 * u_mouse) so the GPU and the CPU interpreter see the same values. One table
 * feeds the GPU header, the uniform setter and the interpreter.
 *
 * Differences from shadertoy.com, on purpose: time runs at a fixed 60 fps
 * (iFrame, iTimeDelta), iMouse.zw stay 0 (no click state), iDate carries only
 * the shader time in .w, and the iChannel inputs are empty textures.
 */

export type ShadertoyType = 'float' | 'int' | 'vec3' | 'vec4' | 'sampler2D' | 'float[4]' | 'vec3[4]';

export interface ShadertoyInputs {
  resolution: [number, number];
  time: number;
  mouse: [number, number];
}

export const FRAME_RATE = 60;

export const SHADERTOY_UNIFORMS: { name: string; type: ShadertoyType; value?: (u: ShadertoyInputs) => number | number[] }[] = [
  { name: 'iResolution', type: 'vec3', value: (u) => [u.resolution[0], u.resolution[1], 1] },
  { name: 'iTime', type: 'float', value: (u) => u.time },
  { name: 'iTimeDelta', type: 'float', value: () => 1 / FRAME_RATE },
  { name: 'iFrameRate', type: 'float', value: () => FRAME_RATE },
  { name: 'iFrame', type: 'int', value: (u) => Math.floor(u.time * FRAME_RATE) },
  { name: 'iMouse', type: 'vec4', value: (u) => [u.mouse[0], u.mouse[1], 0, 0] },
  { name: 'iDate', type: 'vec4', value: (u) => [0, 0, 0, u.time] },
  { name: 'iSampleRate', type: 'float', value: () => 44100 },
  { name: 'iChannelTime', type: 'float[4]', value: () => [0, 0, 0, 0] },
  { name: 'iChannelResolution', type: 'vec3[4]', value: () => Array(12).fill(0) },
  { name: 'iChannel0', type: 'sampler2D' },
  { name: 'iChannel1', type: 'sampler2D' },
  { name: 'iChannel2', type: 'sampler2D' },
  { name: 'iChannel3', type: 'sampler2D' },
];

/** The declarations Shadertoy puts in front of every shader, on one line. */
export const SHADERTOY_HEADER =
  'precision highp float; precision highp int; ' +
  SHADERTOY_UNIFORMS.map(({ name, type }) => {
    const [base, len] = type.split('[');
    return `uniform ${base} ${name}${len ? `[${len}` : ''};`;
  }).join(' ');

/** Values for every non-sampler Shadertoy uniform. Arrays are flattened. */
export function shadertoyValues(u: ShadertoyInputs): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {};
  for (const s of SHADERTOY_UNIFORMS) if (s.value) out[s.name] = s.value(u);
  return out;
}

/** A Shadertoy image shader defines `mainImage(out vec4, in vec2)` and no `main`. */
export function isShadertoy(codeWithoutComments: string): boolean {
  return /\bvoid\s+mainImage\s*\(/.test(codeWithoutComments) && !/\bvoid\s+main\s*\(/.test(codeWithoutComments);
}
