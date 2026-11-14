import type { PrepareOptions } from '../glsl/prepare';
import type { ShaderDiagnostic } from '../glsl/diagnostics';
import { Emitter } from '../events';
import type { CanonicalUniforms } from './gl';
import { FullscreenPass, type BuildResult } from './fullscreen';

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

/**
 * Something that draws instead of the learner's shader while it's active
 * (value-as-image). Plugged in from outside, so the runner knows nothing
 * about probes.
 */
export interface Overlay {
  readonly active: boolean;
  render(width: number, height: number, uniforms: CanonicalUniforms, animating: boolean): void;
  /** The canvas size or the clock jumped: cached readbacks are stale. */
  invalidate(): void;
}

/**
 * Something that draws its own picture instead of the full-screen shader
 * (the 3D mesh view). Plugged in from outside, like the overlay.
 */
export interface Scene {
  readonly active: boolean;
  render(width: number, height: number, uniforms: CanonicalUniforms): void;
}

/**
 * Runs a fragment shader over a full-screen triangle with the canonical
 * uniforms (u_resolution, u_time, u_mouse). A failed compile keeps the last
 * working program on screen. While an overlay is active, it draws instead.
 */
export class ShaderRunner {
  readonly gl: WebGL2RenderingContext;
  readonly pass: FullscreenPass;
  overlay: Overlay | null = null;
  scene: Scene | null = null;
  /** After each frame is drawn. */
  readonly frame = new Emitter<FrameInfo>();
  private program: WebGLProgram | null = null;
  /** Float render targets (EXT_color_buffer_float): needed to read the shader's raw output. */
  private readonly floatTargets: boolean;

  private playing = true;
  private accumulated = 0;
  private playStartedAt = performance.now();
  private mouse: [number, number] = [0, 0];
  private rafId = 0;
  private fps = 0;
  private lastFrameAt = 0;

  mouseMode: MouseMode = 'hover';
  private checkTarget: { fbo: WebGLFramebuffer; tex: WebGLTexture; width: number; height: number } | null = null;

  /**
   * @param fixedSize render at exactly this many pixels instead of following
   *   the canvas's CSS size (used by the self-test page).
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private fixedSize: [number, number] | null = null,
  ) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, depth: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    this.pass = new FullscreenPass(gl);
    // Enabled here, not by whoever happens to need it first: readOutputAt
    // depends on it whether or not a probe overlay exists.
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');

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
    const built = this.pass.build(source);
    if (!built.ok) return { ok: false, diagnostics: built.diagnostics, ms: performance.now() - t0 };
    if (this.program) this.gl.deleteProgram(this.program);
    this.program = built.program;
    return { ok: true, diagnostics: [], ms: performance.now() - t0 };
  }

  /** Build another full-screen program on this context (e.g. a probe shader) without showing it. */
  buildProgram(source: string, options?: PrepareOptions): BuildResult {
    return this.pass.build(source, options);
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
      this.frame.emit({ time: this.time, fps: this.fps, width: this.canvas.width, height: this.canvas.height });
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
    this.overlay?.invalidate();
  }

  /** Render at exactly this many pixels (lessons), or null to follow the CSS size. */
  setFixedSize(size: [number, number] | null): void {
    this.fixedSize = size;
    this.overlay?.invalidate();
  }

  get fixed(): [number, number] | null {
    return this.fixedSize;
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
    if (!this.program || !this.floatTargets) return null;
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
    this.pass.draw(this.program, u);
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

    if (this.overlay?.active) {
      this.overlay.render(width, height, this.uniforms(), this.playing);
      return;
    }
    if (this.scene?.active) {
      this.scene.render(width, height, this.uniforms());
      return;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    if (!this.program) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    this.pass.draw(this.program, this.uniforms());
  }

  private syncSize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.fixedSize?.[0] ?? Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = this.fixedSize?.[1] ?? Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.overlay?.invalidate();
    }
  }
}
