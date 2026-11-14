import { compileShader, linkProgram, setCanonicalUniforms, uniformLocations, type CanonicalUniforms } from '../render/gl';
import type { FullscreenPass } from '../render/fullscreen';
import type { Overlay } from '../render/runner';
import { Emitter } from '../events';
import { PROBE_ITER_UNIFORM } from './rewrite';
import { VISUALIZE_FS } from './visualize';

export type VizMode = 'raw' | 'diverging' | 'auto';
const MODE_INDEX: Record<VizMode, number> = { raw: 0, diverging: 1, auto: 2 };

/** -1 = every component, else a single component index. */
export type Channel = -1 | 0 | 1 | 2 | 3;

export interface ProbeView {
  mode: VizMode;
  channel: Channel;
  /** 0 = last time the probe point ran; N = the Nth time (loops). */
  iteration: number;
}

export interface ProbeStats {
  /** Pixels (in the sampled grid) where the probe captured a value. */
  reached: number;
  sampled: number;
  min: number;
  max: number;
  absMax: number;
  /** Most times any pixel hit the probe point (loops). */
  maxHits: number;
  dim: number;
  kind: number;
}

export interface PixelSample {
  /** Pixel coords, origin bottom-left (same as gl_FragCoord). */
  x: number;
  y: number;
  /** True if the shader didn't discard this pixel. */
  written: boolean;
  hits: number;
  capturedAt: number;
  dim: number;
  kind: number;
  value: number[];
}

const STATS_DOWNSAMPLE = 6;
const STATS_INTERVAL_MS = 250;

interface Target {
  fbo: WebGLFramebuffer;
  value: WebGLTexture;
  meta: WebGLTexture;
  width: number;
  height: number;
}

/**
 * GPU half of value-as-image. Renders the probe shader into two float
 * targets (value, meta), then draws them to the screen with the chosen
 * visualization. Also reads back single pixels (hover) and a downsampled
 * grid (auto range, loop counts).
 */
export class ProbeLayer implements Overlay {
  private program: WebGLProgram | null = null;
  private readonly display: WebGLProgram;
  private full: Target | null = null;
  private small: Target | null = null;
  private lastStatsAt = 0;
  private statsDirty = true;

  view: ProbeView = { mode: 'raw', channel: -1, iteration: 0 };
  stats: ProbeStats | null = null;
  /** New stats after a readback (auto range, loop counts). */
  readonly statsChanged = new Emitter<ProbeStats>();

  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;

  /** Draws on `pass`'s context, which must be the runner's. */
  constructor(pass: FullscreenPass) {
    const gl = (this.gl = pass.gl);
    this.vao = pass.vao;
    const vs = pass.vertexShaders['300 es'];
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('This GPU/browser cannot render to float textures (EXT_color_buffer_float).');
    }
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, VISUALIZE_FS);
    if (!fs.ok) throw new Error(`visualize shader: ${fs.log}`);
    const prog = linkProgram(gl, vs, fs.value);
    if (!prog.ok) throw new Error(`visualize shader: ${prog.log}`);
    this.display = prog.value;
  }

  get active(): boolean {
    return this.program !== null;
  }

  /** Install a compiled probe program (or null to leave inspect mode). */
  setProgram(program: WebGLProgram | null): void {
    if (this.program && this.program !== program) this.gl.deleteProgram(this.program);
    this.program = program;
    this.invalidate();
  }

  setView(view: Partial<ProbeView>): void {
    this.view = { ...this.view, ...view };
    this.invalidate();
  }

  invalidate(): void {
    this.statsDirty = true;
  }

  /** Probe pass into float targets, then display pass to the canvas. */
  render(width: number, height: number, uniforms: CanonicalUniforms, animating: boolean): void {
    const gl = this.gl;
    if (!this.program) return;
    this.full = this.ensureTarget(this.full, width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.full.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, width, height);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [-1, 0, 0, 0]); // hits = -1 → discarded
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    setCanonicalUniforms(gl, this.program, uniforms);
    const iterLoc = uniformLocations(gl, this.program, [PROBE_ITER_UNIFORM])[PROBE_ITER_UNIFORM];
    if (iterLoc) gl.uniform1f(iterLoc, this.view.iteration);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const now = performance.now();
    if (this.statsDirty || (animating && now - this.lastStatsAt > STATS_INTERVAL_MS)) {
      this.stats = this.computeStats();
      this.lastStatsAt = now;
      this.statsDirty = false;
      if (this.stats) this.statsChanged.emit(this.stats);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.display);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.full.value);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.full.meta);
    const loc = uniformLocations(gl, this.display, ['u_value', 'u_meta', 'u_mode', 'u_channel', 'u_range', 'u_absMax', 'u_scale']);
    gl.uniform1i(loc.u_value, 0);
    gl.uniform1i(loc.u_meta, 1);
    gl.uniform1i(loc.u_mode, MODE_INDEX[this.view.mode]);
    gl.uniform1i(loc.u_channel, this.view.channel);
    gl.uniform2f(loc.u_range, this.stats?.min ?? 0, this.stats?.max ?? 1);
    gl.uniform1f(loc.u_absMax, this.stats?.absMax || 1);
    gl.uniform1f(loc.u_scale, Math.min(window.devicePixelRatio || 1, 2));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Exact value at a pixel (origin bottom-left). Call after render(). */
  sample(x: number, y: number): PixelSample | null {
    const gl = this.gl;
    const t = this.full;
    if (!t || !this.program) return null;
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= t.width || py >= t.height) return null;

    const value = new Float32Array(4);
    const meta = new Float32Array(4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.FLOAT, value);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.FLOAT, meta);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

    const dim = Math.round(meta[1]) || 0;
    return {
      x: px,
      y: py,
      written: meta[0] >= 0,
      hits: Math.max(0, meta[0]),
      capturedAt: meta[3],
      dim,
      kind: Math.round(meta[2]),
      value: Array.from(value.slice(0, Math.max(dim, 1))),
    };
  }

  /** Downsample (nearest) and read back to find ranges and loop counts. */
  private computeStats(): ProbeStats | null {
    const gl = this.gl;
    const full = this.full;
    if (!full) return null;
    const sw = Math.max(1, Math.floor(full.width / STATS_DOWNSAMPLE));
    const sh = Math.max(1, Math.floor(full.height / STATS_DOWNSAMPLE));
    this.small = this.ensureTarget(this.small, sw, sh);
    const small = this.small;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, full.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, small.fbo);
    for (const [i, attachment] of [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1].entries()) {
      gl.readBuffer(attachment);
      gl.drawBuffers(i === 0 ? [gl.COLOR_ATTACHMENT0, gl.NONE] : [gl.NONE, gl.COLOR_ATTACHMENT1]);
      gl.blitFramebuffer(0, 0, full.width, full.height, 0, 0, sw, sh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }

    const values = new Float32Array(sw * sh * 4);
    const metas = new Float32Array(sw * sh * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, small.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.FLOAT, values);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.FLOAT, metas);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    let min = Infinity;
    let max = -Infinity;
    let reached = 0;
    let maxHits = 0;
    let dim = 0;
    let kind = 0;
    const channel = this.view.channel;
    for (let i = 0; i < sw * sh; i++) {
      const hits = metas[i * 4];
      if (hits > maxHits) maxHits = hits;
      if (hits <= 0 || metas[i * 4 + 3] <= 0) continue;
      reached++;
      dim = Math.round(metas[i * 4 + 1]);
      kind = Math.round(metas[i * 4 + 2]);
      const first = channel >= 0 ? channel : 0;
      const last = channel >= 0 ? channel : dim - 1;
      for (let c = first; c <= last; c++) {
        const v = values[i * 4 + c];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!reached) {
      min = 0;
      max = 1;
    }
    return {
      reached,
      sampled: sw * sh,
      min,
      max,
      absMax: Math.max(Math.abs(min), Math.abs(max)),
      maxHits,
      dim,
      kind,
    };
  }

  private ensureTarget(t: Target | null, width: number, height: number): Target {
    if (t && t.width === width && t.height === height) return t;
    const gl = this.gl;
    if (t) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.value);
      gl.deleteTexture(t.meta);
    }
    const makeTex = () => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    const value = makeTex();
    const meta = makeTex();
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, value, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, meta, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Probe framebuffer incomplete (0x${status.toString(16)})`);
    return { fbo, value, meta, width, height };
  }
}
