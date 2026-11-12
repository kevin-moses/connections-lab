import { prepareFragmentSource, type GlslVersion } from '../glsl/prepare';
import { parseInfoLog } from '../glsl/diagnostics';
import { compileShader, linkProgram, setCanonicalUniforms, FULLSCREEN_VS_100, FULLSCREEN_VS_300 } from './gl';
import type { Image, RenderRequest, RenderResult } from '../lessons/checker';

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);
const CACHE_SIZE = 12;

/**
 * Renders shaders to small byte images on its own WebGL2 context: for
 * lesson checks (image diff, pixel probes) and the target preview.
 * Output matches what the screen shows: clamped, 8 bits per channel.
 */
export class OffscreenRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly vs: Record<GlslVersion, WebGLShader>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly programs = new Map<string, { program: WebGLProgram } | { error: string }>();
  private target: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2', { antialias: false });
    if (!gl) throw new Error('WebGL2 is not available.');
    this.gl = gl;
    const vs = (code: string) => {
      const r = compileShader(gl, gl.VERTEX_SHADER, code);
      if (!r.ok) throw new Error(r.log);
      return r.value;
    };
    this.vs = { '300 es': vs(FULLSCREEN_VS_300), '100': vs(FULLSCREEN_VS_100) };
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  /** Arrow function so it can be passed around as a `Renderer`. */
  render = (req: RenderRequest): RenderResult => {
    const gl = this.gl;
    const prog = this.program(req.source);
    if ('error' in prog) return { ok: false, error: prog.error };

    const t = this.ensureTarget(req.width, req.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, req.width, req.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.vao);
    setCanonicalUniforms(gl, prog.program, { resolution: [req.width, req.height], time: req.time, mouse: req.mouse });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const data = new Uint8ClampedArray(req.width * req.height * 4);
    gl.readPixels(0, 0, req.width, req.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { ok: true, image: { width: req.width, height: req.height, data } satisfies Image };
  };

  private program(source: string) {
    const hit = this.programs.get(source);
    if (hit) {
      // refresh LRU position
      this.programs.delete(source);
      this.programs.set(source, hit);
      return hit;
    }
    const gl = this.gl;
    const prepared = prepareFragmentSource(source);
    let entry: { program: WebGLProgram } | { error: string };
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, prepared.code);
    if (!fs.ok) {
      const d = parseInfoLog(fs.log, prepared.map, source)[0];
      entry = { error: d ? `${d.line ? `Line ${d.line}: ` : ''}${d.message}` : 'Compile error' };
    } else {
      const linked = linkProgram(gl, this.vs[prepared.version], fs.value);
      entry = linked.ok ? { program: linked.value } : { error: linked.log };
    }
    this.programs.set(source, entry);
    if (this.programs.size > CACHE_SIZE) {
      const [oldKey, old] = this.programs.entries().next().value!;
      if ('program' in old) gl.deleteProgram(old.program);
      this.programs.delete(oldKey);
    }
    return entry;
  }

  private ensureTarget(w: number, h: number) {
    const gl = this.gl;
    if (this.target && this.target.w === w && this.target.h === h) return this.target;
    if (this.target) {
      gl.deleteFramebuffer(this.target.fbo);
      gl.deleteTexture(this.target.tex);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.target = { fbo, tex, w, h };
    return this.target;
  }
}

/** Draw a bottom-up RGBA image into a 2D canvas (flipping it upright). */
export function paintImage(canvas: HTMLCanvasElement, img: Image): void {
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(img.width, img.height);
  const row = img.width * 4;
  for (let y = 0; y < img.height; y++) {
    out.data.set(img.data.subarray((img.height - 1 - y) * row, (img.height - y) * row), y * row);
  }
  ctx.putImageData(out, 0, 0);
}
