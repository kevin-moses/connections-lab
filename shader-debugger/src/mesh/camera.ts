import { identity, lookAt, multiply, normalMatrix, perspective, type Mat3, type Mat4 } from './mat4';

export interface MeshMatrices {
  modelView: Mat4;
  projection: Mat4;
  normal: Mat3;
}

const DRAG_START_PX = 4;

/**
 * Orbits the origin: drag to turn, wheel to zoom. A press that doesn't move
 * stays a click (the Debugger uses clicks to pick a vertex).
 */
export class OrbitCamera {
  yaw = 0.6;
  pitch = 0.45;
  distance = 2;
  enabled = false;
  private drag: { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly onChange: () => void = () => {}) {
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || !(e.buttons & 1)) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_START_PX) return;
      d.moved = true;
      this.yaw = d.yaw - dx * 0.01;
      this.pitch = Math.max(-1.5, Math.min(1.5, d.pitch + dy * 0.01));
      this.onChange();
    });
    window.addEventListener('pointerup', () => (this.drag = null));
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.distance = Math.max(0.6, Math.min(8, this.distance * Math.exp(e.deltaY * 0.001)));
        this.onChange();
      },
      { passive: false },
    );
  }

  matrices(aspect: number): MeshMatrices {
    return orbitMatrices(this.yaw, this.pitch, this.distance, aspect);
  }
}

/** Looking at the origin from `distance` away. The model is at the origin, unscaled: model-view is just the view. */
export function orbitMatrices(yaw: number, pitch: number, distance: number, aspect: number): MeshMatrices {
  const eye: [number, number, number] = [
    distance * Math.cos(pitch) * Math.sin(yaw),
    distance * Math.sin(pitch),
    distance * Math.cos(pitch) * Math.cos(yaw),
  ];
  const modelView = multiply(lookAt(eye, [0, 0, 0], [0, 1, 0]), identity());
  return { modelView, projection: perspective(Math.PI / 4, aspect, 0.05, 50), normal: normalMatrix(modelView) };
}
