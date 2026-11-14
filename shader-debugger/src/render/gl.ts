import { SHADERTOY_UNIFORMS, shadertoyValues } from '../glsl/shadertoy';
export type CompileOutcome<T> = { ok: true; value: T } | { ok: false; log: string };

export function compileShader(gl: WebGL2RenderingContext, type: GLenum, code: string): CompileOutcome<WebGLShader> {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, code);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return { ok: true, value: shader };
  const log = gl.getShaderInfoLog(shader) ?? 'Unknown compile error';
  gl.deleteShader(shader);
  return { ok: false, log };
}

/** Links and then deletes the fragment shader (vertex shaders are shared). */
export function linkProgram(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
): CompileOutcome<WebGLProgram> {
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_position');
  gl.linkProgram(program);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return { ok: true, value: program };
  const log = gl.getProgramInfoLog(program) ?? 'Unknown link error';
  gl.deleteProgram(program);
  return { ok: false, log };
}

/**
 * Covers the viewport and supplies the usual 0..1 varyings: `vTexCoord` the
 * way p5 does for a full-canvas plane ((0, 0) at the top-left, y down), and
 * `vUv` the way three.js's PlaneGeometry does ((0, 0) at the bottom-left).
 * Every learner shader is compiled as ES 3.00 (ES 1.00 code is converted
 * first), so one vertex shader is enough.
 */
export const FULLSCREEN_VS = `#version 300 es
in vec2 a_position;
out vec2 vTexCoord;
out vec2 vUv;
void main() {
  vUv = a_position * 0.5 + 0.5;
  vTexCoord = vec2(vUv.x, 1.0 - vUv.y);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/** Canonical uniforms every learner shader may use. */
export interface CanonicalUniforms {
  resolution: [number, number];
  time: number;
  mouse: [number, number];
}

const SHADERTOY_NAMES = SHADERTOY_UNIFORMS.filter((s) => s.value).map((s) => s.name);
const SHADERTOY_TYPES = new Map(SHADERTOY_UNIFORMS.map((s) => [s.name, s.type]));

export function setCanonicalUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, u: CanonicalUniforms) {
  const loc = uniformLocations(gl, program, SHADERTOY_NAMES);
  if (loc.resolution) gl.uniform2f(loc.resolution, u.resolution[0], u.resolution[1]);
  if (loc.time) gl.uniform1f(loc.time, u.time);
  if (loc.mouse) gl.uniform2f(loc.mouse, u.mouse[0], u.mouse[1]);
  // Shadertoy's inputs, for programs that declare them (the GPU drops unused ones).
  if (!SHADERTOY_NAMES.some((n) => loc[n])) return;
  for (const [name, value] of Object.entries(shadertoyValues(u))) {
    const l = loc[name];
    if (!l) continue;
    const v = Array.isArray(value) ? value : [value];
    switch (SHADERTOY_TYPES.get(name)) {
      case 'int': gl.uniform1i(l, v[0]); break;
      case 'vec3': case 'vec3[4]': gl.uniform3fv(l, v); break;
      case 'vec4': gl.uniform4fv(l, v); break;
      default: gl.uniform1fv(l, v);
    }
  }
}

const locationCache = new WeakMap<WebGLProgram, Record<string, WebGLUniformLocation | null>>();

/** Cached uniform lookup (canonical names plus any extra names asked for). */
export function uniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram, extra: string[] = []) {
  let cached = locationCache.get(program);
  if (!cached) {
    cached = {
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      mouse: gl.getUniformLocation(program, 'u_mouse'),
    };
    locationCache.set(program, cached);
  }
  for (const name of extra) if (!(name in cached)) cached[name] = gl.getUniformLocation(program, name);
  return cached;
}
