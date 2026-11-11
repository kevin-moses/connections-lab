import { prepareFragmentSource, type GlslVersion } from '../glsl/prepare';
import { parseInfoLog, type ShaderDiagnostic } from '../glsl/diagnostics';
import {
  compileShader,
  linkProgram,
  setCanonicalUniforms,
  FULLSCREEN_VS_100,
  FULLSCREEN_VS_300,
  type CanonicalUniforms,
} from './gl';
import { ProbeLayer } from '../probe/probeLayer';

export interface CompileResult {
  ok: boolean;
  diagnostics: ShaderDiagnostic[];
  ms: number;
}

export interface FrameInfo {
  time: number;
  fps: number;
  width: number;
  height: number;
}

/**
 * `hover`: u_mouse follows the pointer (Book of Shaders style).
 * `drag`: u_mouse only moves while the button is held, so hovering to read
 * values doesn't change what you're reading.
 */
export type MouseMode = 'hover' | 'drag';

/** Cleared into the readback pixel; still there afterwards = the GPU discarded it. */
export const DISCARD_SENTINEL = -1e30;

// One triangle that covers the whole viewport.
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

/**
 * Runs a fragment shader over a full-screen triangle with the canonical
 * uniforms (u_resolution, u_time, u_mouse). A failed compile keeps the last
 * working program on screen. When a probe program is installed, the probe
 * layer draws instead.
 */
export class ShaderRunner {
  readonly gl: WebGL2RenderingContext;
  readonly probe: ProbeLayer;
  private program: WebGLProgram | null = null;
  private readonly vertexShaders: Record<GlslVersion, WebGLShader>;
  private readonly vao: WebGLVertexArrayObject;

  private playing = true;
  private accumulated = 0;
  private playStartedAt = performance.now();
  private mouse: [number, number] = [0, 0];
  private rafId = 0;
  private fps = 0;
  private lastFrameAt = 0;

  mouseMode: MouseMode = 'hover';
  onFrame: ((info: FrameInfo) => void) | null = null;
  /** Called after each frame is drawn (e.g. to read back pixels). */
  afterDraw: (() => void) | null = null;
  private checkTarget: { fbo: WebGLFramebuffer; tex: WebGLTexture; width: number; height: number } | null = null;

  /**
   * @param fixedSize render at exactly this many pixels instead of following
   *   the canvas's CSS size (used by the self-test page).
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly fixedSize: [number, number] | null = null,
  ) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
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
    this.probe = new ProbeLayer(gl, this.vao, this.vertexShaders['300 es']);

    // hover: follow the pointer. drag: only while the button is held and
    // moving, so a plain click (which picks a pixel to debug) leaves it alone.
    canvas.addEventListener('pointermove', (e) => {
      if (this.mouseMode === 'drag' && !(e.buttons & 1)) return;
      this.mouse = this.toCanvasPixels(e);
    });
  }

  /** Pointer event → canvas pixels, origin bottom-left (like gl_FragCoord). */
  toCanvasPixels(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    return [(e.clientX - rect.left) * sx, (rect.bottom - e.clientY) * sy];
  }

  /** Compile the learner's shader (the normal view). */
  compile(source: string): CompileResult {
    const t0 = performance.now();
    const built = this.build(source);
    if (!built.ok) return { ok: false, diagnostics: built.diagnostics, ms: performance.now() - t0 };
    if (this.program) this.gl.deleteProgram(this.program);
    this.program = built.program;
    return { ok: true, diagnostics: [], ms: performance.now() - t0 };
  }

  /**
   * Compile a probe shader (already rewritten). On success the probe layer
   * takes over drawing; on failure the previous probe stays.
   */
  compileProbe(probeSource: string): CompileResult {
    const t0 = performance.now();
    const built = this.build(probeSource);
    if (!built.ok) return { ok: false, diagnostics: built.diagnostics, ms: performance.now() - t0 };
    this.probe.setProgram(built.program);
    return { ok: true, diagnostics: [], ms: performance.now() - t0 };
  }

  clearProbe(): void {
    this.probe.setProgram(null);
  }

  private build(source: string): { ok: true; program: WebGLProgram } | { ok: false; diagnostics: ShaderDiagnostic[] } {
    const gl = this.gl;
    const prepared = prepareFragmentSource(source);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, prepared.code);
    if (!fs.ok) return { ok: false, diagnostics: parseInfoLog(fs.log, prepared.map, source) };
    const prog = linkProgram(gl, this.vertexShaders[prepared.version], fs.value);
    if (!prog.ok) {
      return { ok: false, diagnostics: [{ line: null, message: prog.log.trim(), severity: 'error', origin: 'link' }] };
    }
    return { ok: true, program: prog.value };
  }

  start(): void {
    const frame = (now: number) => {
      this.rafId = requestAnimationFrame(frame);
      if (this.lastFrameAt) {
        const instant = 1000 / Math.max(1, now - this.lastFrameAt);
        this.fps = this.fps ? this.fps * 0.9 + instant * 0.1 : instant;
      }
      this.lastFrameAt = now;
      this.draw();
      this.afterDraw?.();
      this.onFrame?.({ time: this.time, fps: this.fps, width: this.canvas.width, height: this.canvas.height });
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  get time(): number {
    return this.accumulated + (this.playing ? (performance.now() - this.playStartedAt) / 1000 : 0);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setPlaying(playing: boolean): void {
    if (playing === this.playing) return;
    if (playing) this.playStartedAt = performance.now();
    else this.accumulated = this.time;
    this.playing = playing;
  }

  resetTime(): void {
    this.accumulated = 0;
    this.playStartedAt = performance.now();
    this.probe.invalidateStats();
  }

  /** The uniforms the next frame would use (to freeze them for a trace). */
  currentUniforms(): CanonicalUniforms {
    return this.uniforms();
  }

  get hasProgram(): boolean {
    return this.program !== null;
  }

  /**
   * Run the learner's shader for one pixel on the GPU and return its raw
   * (unclamped) output, for comparing against the CPU interpreter.
   */
  readOutputAt(px: number, py: number, u: CanonicalUniforms): number[] | null {
    const gl = this.gl;
    if (!this.program) return null;
    this.syncSize();
    const { width, height } = this.canvas;
    if (!this.checkTarget || this.checkTarget.width !== width || this.checkTarget.height !== height) {
      if (this.checkTarget) {
        gl.deleteFramebuffer(this.checkTarget.fbo);
        gl.deleteTexture(this.checkTarget.tex);
      }
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.checkTarget = { fbo, tex, width, height };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.checkTarget.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(px, py, 1, 1);
    gl.clearBufferfv(gl.COLOR, 0, [DISCARD_SENTINEL, 0, 0, 0]);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    setCanonicalUniforms(gl, this.program, u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    const out = new Float32Array(4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Array.from(out);
  }

  private uniforms(): CanonicalUniforms {
    return {
      resolution: [this.canvas.width, this.canvas.height],
      time: this.time,
      mouse: this.mouse,
    };
  }

  private draw(): void {
    const gl = this.gl;
    this.syncSize();
    const { width, height } = this.canvas;

    if (this.probe.active) {
      this.probe.render(width, height, this.uniforms(), this.playing);
      return;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    if (!this.program) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    setCanonicalUniforms(gl, this.program, this.uniforms());
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private syncSize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.fixedSize?.[0] ?? Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = this.fixedSize?.[1] ?? Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.probe.invalidateStats();
    }
  }
}
