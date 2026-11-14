/** RGBA bytes, row 0 = bottom (like gl.readPixels and gl_FragCoord). */
export interface Image {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface RenderRequest {
  source: string;
  width: number;
  height: number;
  time: number;
  /** Pixels, origin bottom-left. */
  mouse: [number, number];
}

export type RenderResult = { ok: true; image: Image } | { ok: false; error: string };

/** Anything that turns a shader into an image: the GPU (offscreen.ts) or the CPU interpreter (lessons/cpuRender.ts). */
export type Renderer = (req: RenderRequest) => RenderResult;
