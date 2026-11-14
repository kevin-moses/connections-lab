import { FRAG_COLOR_OUT, prepareFragmentSource, type PrepareOptions } from '../glsl/prepare';
import { parseInfoLog, type ShaderDiagnostic } from '../glsl/diagnostics';
import { compileShader, linkProgram, setCanonicalUniforms, FULLSCREEN_VS, type CanonicalUniforms } from './gl';

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
  readonly vertexShader: WebGLShader;

  constructor(readonly gl: WebGL2RenderingContext) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const vs = compileShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VS);
    if (!vs.ok) throw new Error(`internal vertex shader: ${vs.log}`);
    this.vertexShader = vs.value;
  }

  /** Compile and link a learner's fragment shader (converted to ES 3.00, errors on their lines). */
  build(source: string, options?: PrepareOptions): BuildResult {
    const gl = this.gl;
    const prepared = prepareFragmentSource(source, options);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, prepared.code);
    if (!fs.ok) {
      // Errors about converted ES 1.00 code use our names; show the learner's.
      const log = fs.log.replaceAll(FRAG_COLOR_OUT, 'gl_FragColor');
      return { ok: false, diagnostics: parseInfoLog(log, prepared.map, source) };
    }
    const prog = linkProgram(gl, this.vertexShader, fs.value);
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
