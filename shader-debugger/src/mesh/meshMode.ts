import type { Program } from '@shaderfrog/glsl-parser/ast';
import type { EditorState } from '@codemirror/state';
import type { Debugger, PixelRun } from '../debugger/debugger';
import { crossCheck } from '../debugger/crossCheck';
import type { ShaderEditor } from '../editor/editor';
import { parseGlsl, type ParseResult } from '../glsl/parse';
import { traceVertex } from '../interp/interpreter';
import type { CanonicalUniforms } from '../render/gl';
import type { ShaderRunner } from '../render/runner';
import type { MeshMatrices } from './camera';
import { DEFAULT_FRAGMENT, DEFAULT_VERTEX } from './defaultShaders';
import { MESH_NAMES, vertexAttributes, type MeshName } from './geometry';
import type { MeshBuild, MeshScene } from './scene';

export type MeshFile = 'vertex' | 'fragment';

const STORAGE_KEY = 'shader-debugger:mesh:v1';
const BUILD_DEBOUNCE_MS = 200;
/** How close (CSS pixels) a click has to be to a vertex to pick it. */
const PICK_RADIUS_CSS = 24;

interface Saved {
  vertex: string;
  fragment: string;
  mesh: MeshName;
}

export interface MeshModeUI {
  tabs: HTMLElement;
  fileName: HTMLElement;
  meshSelect: HTMLSelectElement;
}

export interface MeshReport {
  build: MeshBuild;
  vertexParse: ParseResult;
  /** The tab on screen: its errors go in the editor. */
  file: MeshFile;
}

/**
 * The sandbox's 3D view: a vertex and a fragment shader (two editor tabs)
 * on a built-in mesh. A click near a vertex steps through the vertex shader
 * for it, checked against the GPU's own gl_Position for that vertex.
 */
export class MeshMode {
  active = false;
  file: MeshFile = 'vertex';
  private saved: Saved;
  /** The tab not on screen keeps its editor state here. */
  private hidden: EditorState | null = null;
  private vertexAst: Program | null = null;
  private timer = 0;
  private last: MeshReport | null = null;

  constructor(
    private readonly runner: ShaderRunner,
    readonly scene: MeshScene,
    private readonly editor: ShaderEditor,
    private readonly debug: Debugger,
    private readonly ui: MeshModeUI,
    /** Show a build's results (status, errors, problems). */
    private readonly report: (r: MeshReport) => void,
  ) {
    this.saved = load();
    ui.meshSelect.replaceChildren(...MESH_NAMES.map((n) => new Option(n[0].toUpperCase() + n.slice(1), n)));
    ui.meshSelect.value = this.saved.mesh;
    ui.meshSelect.addEventListener('change', () => {
      this.saved.mesh = ui.meshSelect.value as MeshName;
      save(this.saved);
      this.scene.setMesh(this.saved.mesh);
      this.debug.close();
    });
    ui.tabs.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-file]');
      if (b) this.show(b.dataset.file as MeshFile);
    });
    runner.scene = scene;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.file = 'vertex';
    this.scene.setMesh(this.saved.mesh);
    this.editor.replaceDocument(this.saved.vertex);
    this.hidden = this.editor.createState(this.saved.fragment);
    this.scene.active = true;
    this.debug.close();
    this.debug.canvasPick = (px, which) => this.pick(px, which);
    this.debug.showsRunCode = () => this.file === 'vertex';
    this.ui.tabs.hidden = false;
    this.ui.fileName.hidden = true;
    this.ui.meshSelect.hidden = false;
    this.renderTabs();
    this.build();
  }

  exit(): void {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.active = false;
    this.scene.active = false;
    this.debug.canvasPick = null;
    this.debug.showsRunCode = null;
    this.debug.close();
    this.hidden = null;
    this.ui.tabs.hidden = true;
    this.ui.fileName.hidden = false;
    this.ui.meshSelect.hidden = true;
  }

  /** The editor changed: save that file and rebuild shortly. */
  onEdit(source: string): void {
    this.saved[this.file] = source;
    save(this.saved);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.build(), BUILD_DEBOUNCE_MS);
  }

  /** Both shaders back to the starting example. */
  loadExample(): void {
    this.saved.vertex = DEFAULT_VERTEX;
    this.saved.fragment = DEFAULT_FRAGMENT;
    save(this.saved);
    this.file = 'vertex';
    this.editor.replaceDocument(DEFAULT_VERTEX);
    this.hidden = this.editor.createState(DEFAULT_FRAGMENT);
    this.renderTabs();
    this.build();
  }

  /** Switch the editor to the other file; each keeps its own undo history. */
  show(file: MeshFile): void {
    if (file === this.file || !this.hidden) return;
    this.hidden = this.editor.swapState(this.hidden);
    this.file = file;
    this.renderTabs();
    if (this.last) this.report({ ...this.last, file });
    this.debug.refresh();
  }

  build(): void {
    clearTimeout(this.timer);
    const build = this.scene.build(this.saved.vertex, this.saved.fragment);
    const vertexParse = parseGlsl(this.saved.vertex);
    this.vertexAst = vertexParse.ok ? vertexParse.ast : null;
    this.last = { build, vertexParse, file: this.file };
    this.report(this.last);
    if (build.ok) this.debug.refresh();
  }

  private renderTabs(): void {
    for (const b of this.ui.tabs.querySelectorAll<HTMLButtonElement>('button[data-file]')) {
      b.setAttribute('aria-selected', String(b.dataset.file === this.file));
    }
  }

  /** A click on the canvas: step through the nearest vertex. */
  private pick(canvasPx: [number, number], which: 'a' | 'b'): void {
    if (!this.scene.hasProgram) return;
    const u = this.runner.currentUniforms();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const hit = this.scene.pick(canvasPx[0], canvasPx[1], u, PICK_RADIUS_CSS * dpr);
    if (!hit) return;
    const m = this.scene.matrices();
    this.show('vertex');
    this.debug.stepRun(() => this.runVertex(hit.index, u, m), which, u);
  }

  private runVertex(index: number, u: CanonicalUniforms, m: MeshMatrices): PixelRun {
    const mesh = this.scene.mesh;
    const uniforms = { u_resolution: u.resolution, u_time: u.time, u_mouse: u.mouse, ...this.scene.matrixUniforms(m) };
    const trace = this.vertexAst
      ? traceVertex(this.vertexAst, { attributes: vertexAttributes(mesh, index), vertexId: index, uniforms })
      : { steps: [], output: null, discarded: false, truncated: false, inputs: [], error: { message: "The vertex shader doesn't parse.", line: null } };
    const clip = this.scene.readPositions(u, m);
    const gpu = clip && index < clip.length / 4 ? Array.from(clip.subarray(index * 4, index * 4 + 4)) : null;
    const [w, h] = u.resolution;
    const at: [number, number] | null = gpu && gpu[3] > 1e-6 ? [Math.floor(((gpu[0] / gpu[3]) * 0.5 + 0.5) * w), Math.floor(((gpu[1] / gpu[3]) * 0.5 + 0.5) * h)] : null;
    return { pixel: at, call: null, vertex: index, trace, check: crossCheck(trace, gpu, 'vertex') };
  }
}

function load(): Saved {
  const fallback: Saved = { vertex: DEFAULT_VERTEX, fragment: DEFAULT_FRAGMENT, mesh: 'plane' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Saved>;
    return {
      vertex: s.vertex ?? fallback.vertex,
      fragment: s.fragment ?? fallback.fragment,
      mesh: MESH_NAMES.includes(s.mesh as MeshName) ? (s.mesh as MeshName) : 'plane',
    };
  } catch {
    return fallback;
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: keep working without saving */
  }
}
