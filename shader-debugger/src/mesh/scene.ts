import { parseInfoLog, type ShaderDiagnostic } from '../glsl/diagnostics';
import { FRAG_COLOR_OUT, prepareFragmentSource, prepareVertexSource } from '../glsl/prepare';
import { compileShader, setCanonicalUniforms, type CanonicalUniforms } from '../render/gl';
import type { Scene } from '../render/runner';
import { OrbitCamera, type MeshMatrices } from './camera';
import { ATTRIBUTES, buildMesh, type Mesh, type MeshName } from './geometry';

export interface MeshBuild {
  ok: boolean;
  vertex: ShaderDiagnostic[];
  fragment: ShaderDiagnostic[];
  ms: number;
}

/** How far (in NDC depth) behind the front-most candidate a vertex can be and still be picked. */
const DEPTH_SLACK = 0.01;

/** Drawn into the capture program's discarded fragments; never shown. */
const CAPTURE_FS = '#version 300 es\nprecision highp float;\nout vec4 c;\nvoid main() { c = vec4(0.0); }';

/**
 * The learner's vertex + fragment shaders on a built-in mesh, seen through
 * an orbit camera. Also runs the vertex shader alone with transform feedback
 * to read back every vertex's gl_Position (for picking and the cross-check).
 */
export class MeshScene implements Scene {
  readonly camera: OrbitCamera;
  mesh: Mesh = buildMesh('plane');
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private program: WebGLProgram | null = null;
  private capture: WebGLProgram | null = null;
  private readonly tf: WebGLTransformFeedback;
  private readonly tfBuffer: WebGLBuffer;
  private size: [number, number] = [1, 1];

  constructor(private readonly gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.camera = new OrbitCamera(canvas);
    this.tf = gl.createTransformFeedback()!;
    this.tfBuffer = gl.createBuffer()!;
    this.setMesh('plane');
  }

  get active(): boolean {
    return this.camera.enabled;
  }

  set active(on: boolean) {
    this.camera.enabled = on;
  }

  get hasProgram(): boolean {
    return this.program !== null;
  }

  setMesh(name: MeshName): void {
    const gl = this.gl;
    this.mesh = buildMesh(name);
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buffers = ATTRIBUTES.map((a, loc) => {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.mesh[a.key], gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, 0, 0);
      return buf;
    });
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.mesh.indices, gl.STATIC_DRAW);
    this.buffers.push(ib);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tfBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.mesh.vertexCount * 16, gl.DYNAMIC_READ);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Compile and link both stages. A failure keeps the last working pair on screen. */
  build(vertexSource: string, fragmentSource: string): MeshBuild {
    const gl = this.gl;
    const t0 = performance.now();
    const vp = prepareVertexSource(vertexSource);
    const fp = prepareFragmentSource(fragmentSource);
    const vs = compileShader(gl, gl.VERTEX_SHADER, vp.code);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fp.code);
    const vertex = vs.ok ? [] : parseInfoLog(vs.log, vp.map, vertexSource);
    const fragment = fs.ok ? [] : parseInfoLog(fs.log.replaceAll(FRAG_COLOR_OUT, 'gl_FragColor'), fp.map, fragmentSource);
    const fail = (extra: ShaderDiagnostic[] = []) => ({ ok: false, vertex, fragment: [...fragment, ...extra], ms: performance.now() - t0 });
    if (!vs.ok || !fs.ok) return fail();

    const link = (frag: WebGLShader, feedback: boolean) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, vs.value);
      gl.attachShader(p, frag);
      ATTRIBUTES.forEach((a, loc) => gl.bindAttribLocation(p, loc, a.name));
      if (feedback) gl.transformFeedbackVaryings(p, ['gl_Position'], gl.SEPARATE_ATTRIBS);
      gl.linkProgram(p);
      if (gl.getProgramParameter(p, gl.LINK_STATUS)) return { ok: true as const, p };
      const log = gl.getProgramInfoLog(p) ?? 'Link error';
      gl.deleteProgram(p);
      return { ok: false as const, log };
    };
    const main = link(fs.value, false);
    if (!main.ok) return fail([{ line: null, message: `The two shaders don't fit together: ${main.log.trim()}`, severity: 'error', origin: 'link' }]);
    const cfs = compileShader(gl, gl.FRAGMENT_SHADER, CAPTURE_FS);
    const cap = cfs.ok ? link(cfs.value, true) : null;

    if (this.program) gl.deleteProgram(this.program);
    if (this.capture) gl.deleteProgram(this.capture);
    this.program = main.p;
    this.capture = cap?.ok ? cap.p : null;
    return { ok: true, vertex: [], fragment: [], ms: performance.now() - t0 };
  }

  matrices(width = this.size[0], height = this.size[1]): MeshMatrices {
    return this.camera.matrices(width / Math.max(1, height));
  }

  render(width: number, height: number, u: CanonicalUniforms): void {
    const gl = this.gl;
    this.size = [width, height];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.06, 0.07, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.program) return;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    this.setUniforms(this.program, u, this.matrices(width, height));
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  /** Every vertex's gl_Position, straight from the GPU (4 floats each), or null if it can't be read. */
  readPositions(u: CanonicalUniforms, m: MeshMatrices): Float32Array | null {
    const gl = this.gl;
    if (!this.capture) return null;
    gl.useProgram(this.capture);
    this.setUniforms(this.capture, u, m);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.tfBuffer);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.mesh.vertexCount);
    gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindVertexArray(null);
    const out = new Float32Array(this.mesh.vertexCount * 4);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, this.tfBuffer);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    return out;
  }

  /**
   * The vertex nearest to a canvas pixel (origin bottom-left), within
   * `radius` pixels. Vertices well behind the front-most candidate (the back
   * of a sphere) don't count. Uses the positions the learner's vertex shader
   * actually produced.
   */
  pick(px: number, py: number, u: CanonicalUniforms, radius: number): { index: number; at: [number, number] } | null {
    const [w, h] = this.size;
    const clip = this.readPositions(u, this.matrices());
    if (!clip) return null;
    const near: { index: number; at: [number, number]; depth: number; d: number }[] = [];
    for (let i = 0; i < this.mesh.vertexCount; i++) {
      const at = toPixels(clip, i, w, h);
      if (!at) continue;
      const d = Math.hypot(at[0] - px, at[1] - py);
      if (d <= radius) near.push({ index: i, at: [at[0], at[1]], depth: at[2], d });
    }
    if (!near.length) return null;
    const front = Math.min(...near.map((n) => n.depth));
    const best = near.filter((n) => n.depth <= front + DEPTH_SLACK).sort((a, b) => a.d - b.d)[0];
    return { index: best.index, at: best.at };
  }

  /** Where vertex `i` lands on the canvas now (for the marker), or null if it's behind the camera. */
  screenPosition(i: number, u: CanonicalUniforms): [number, number] | null {
    const clip = this.readPositions(u, this.matrices());
    const at = clip && toPixels(clip, i, this.size[0], this.size[1]);
    return at ? [at[0], at[1]] : null;
  }

  /** The matrices as the shader sees them, for the CPU stepper. */
  matrixUniforms(m: MeshMatrices): Record<string, number[]> {
    return { uModelViewMatrix: m.modelView, uProjectionMatrix: m.projection, uNormalMatrix: m.normal };
  }

  private setUniforms(p: WebGLProgram, u: CanonicalUniforms, m: MeshMatrices): void {
    const gl = this.gl;
    setCanonicalUniforms(gl, p, u);
    const set = (name: string, f: (l: WebGLUniformLocation) => void) => {
      const l = gl.getUniformLocation(p, name);
      if (l) f(l);
    };
    set('uModelViewMatrix', (l) => gl.uniformMatrix4fv(l, false, m.modelView));
    set('uProjectionMatrix', (l) => gl.uniformMatrix4fv(l, false, m.projection));
    set('uNormalMatrix', (l) => gl.uniformMatrix3fv(l, false, m.normal));
  }
}

/** Clip position → canvas pixels (origin bottom-left) and depth, or null behind the camera. */
function toPixels(clip: Float32Array, i: number, w: number, h: number): [number, number, number] | null {
  const [x, y, z, cw] = [clip[i * 4], clip[i * 4 + 1], clip[i * 4 + 2], clip[i * 4 + 3]];
  if (cw <= 1e-6) return null;
  return [((x / cw) * 0.5 + 0.5) * w, ((y / cw) * 0.5 + 0.5) * h, z / cw];
}

