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

export const FULLSCREEN_VS_300 = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

export const FULLSCREEN_VS_100 = `#version 100
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

/** Canonical uniforms every learner shader may use. */
export interface CanonicalUniforms {
  resolution: [number, number];
  time: number;
  mouse: [number, number];
}

export function setCanonicalUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, u: CanonicalUniforms) {
  const loc = uniformLocations(gl, program);
  if (loc.resolution) gl.uniform2f(loc.resolution, u.resolution[0], u.resolution[1]);
  if (loc.time) gl.uniform1f(loc.time, u.time);
  if (loc.mouse) gl.uniform2f(loc.mouse, u.mouse[0], u.mouse[1]);
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
