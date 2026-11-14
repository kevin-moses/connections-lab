import { prepareFragmentSource, type GlslVersion } from '../glsl/prepare';
import { parseInfoLog, type ShaderDiagnostic } from '../glsl/diagnostics';
import { compileShader, linkProgram, setCanonicalUniforms, FULLSCREEN_VS_100, FULLSCREEN_VS_300, type CanonicalUniforms } from './gl';

// One triangle that covers the whole viewport.
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

export type BuildResult = { ok: true; program: WebGLProgram } | { ok: false; diagnostics: ShaderDiagnostic[] };

/**
 * The plumbing every full-screen fragment shader needs on one WebGL2
 * context: a covering triangle, the shared vertex shaders, building a
 * learner's shader (with errors mapped back to their lines), and drawing it.
 */
export class FullscreenPass {
  readonly vao: WebGLVertexArrayObject;
  readonly vertexShaders: Record<GlslVersion, WebGLShader>;

  constructor(readonly gl: WebGL2RenderingContext) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const vs = (code: string) => {
      const r = compileShader(gl, gl.VERTEX_SHADER, code);
      if (!r.ok) throw new Error(`internal vertex shader: ${r.log}`);
      return r.value;
    };
    this.vertexShaders = { '300 es': vs(FULLSCREEN_VS_300), '100': vs(FULLSCREEN_VS_100) };
  }

  /** Compile and link a learner's fragment shader (version line injected, errors on their lines). */
  build(source: string): BuildResult {
    const gl = this.gl;
    const prepared = prepareFragmentSource(source);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, prepared.code);
    if (!fs.ok) return { ok: false, diagnostics: parseInfoLog(fs.log, prepared.map, source) };
    const prog = linkProgram(gl, this.vertexShaders[prepared.version], fs.value);
    if (!prog.ok) return { ok: false, diagnostics: [{ line: null, message: prog.log.trim(), severity: 'error', origin: 'link' }] };
    return { ok: true, program: prog.value };
  }

  /** Draw `program` over the bound framebuffer's viewport with the canonical uniforms. */
  draw(program: WebGLProgram, uniforms: CanonicalUniforms): void {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    setCanonicalUniforms(gl, program, uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
