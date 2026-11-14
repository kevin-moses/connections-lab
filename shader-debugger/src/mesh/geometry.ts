/**
 * Built-in meshes, sized like p5's (whose vertex shaders see these unit
 * shapes before the model matrix scales them): the plane and box span
 * −0.5..0.5, the sphere has radius 0.5 here so all three fit the same view.
 * Texture coordinates follow p5: (0, 0) at the top-left of the plane.
 */

export type MeshName = 'plane' | 'sphere' | 'box';
export const MESH_NAMES: MeshName[] = ['plane', 'sphere', 'box'];

export interface Mesh {
  name: MeshName;
  /** xyz per vertex */
  positions: Float32Array;
  /** xyz per vertex, unit length */
  normals: Float32Array;
  /** uv per vertex */
  texcoords: Float32Array;
  /** triangles */
  indices: Uint16Array;
  vertexCount: number;
}

/** The attribute names the app's vertex shaders use (p5's), with their sizes. */
export const ATTRIBUTES = [
  { name: 'aPosition', size: 3, key: 'positions' },
  { name: 'aNormal', size: 3, key: 'normals' },
  { name: 'aTexCoord', size: 2, key: 'texcoords' },
] as const;

/** One vertex's attribute values, by name (for the CPU stepper). */
export function vertexAttributes(mesh: Mesh, i: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const a of ATTRIBUTES) out[a.name] = Array.from(mesh[a.key].subarray(i * a.size, (i + 1) * a.size));
  return out;
}

export function buildMesh(name: MeshName): Mesh {
  return name === 'plane' ? plane(24) : name === 'sphere' ? sphere(24, 16) : box();
}

class Builder {
  p: number[] = [];
  n: number[] = [];
  t: number[] = [];
  i: number[] = [];
  vertex(p: number[], n: number[], t: number[]): number {
    this.p.push(...p);
    this.n.push(...n);
    this.t.push(...t);
    return this.p.length / 3 - 1;
  }
  done(name: MeshName): Mesh {
    return {
      name,
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      texcoords: new Float32Array(this.t),
      indices: new Uint16Array(this.i),
      vertexCount: this.p.length / 3,
    };
  }
}

/** A grid in the xy plane facing +z, `segs` × `segs` quads (enough to bend). */
function plane(segs: number): Mesh {
  const b = new Builder();
  for (let iy = 0; iy <= segs; iy++) {
    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const v = iy / segs;
      b.vertex([u - 0.5, 0.5 - v, 0], [0, 0, 1], [u, v]);
    }
  }
  quads(b, segs, segs, 0);
  return b.done('plane');
}

/** Latitude/longitude sphere, radius 0.5. */
function sphere(lon: number, lat: number): Mesh {
  const b = new Builder();
  for (let iy = 0; iy <= lat; iy++) {
    const v = iy / lat;
    const theta = v * Math.PI;
    for (let ix = 0; ix <= lon; ix++) {
      const u = ix / lon;
      const phi = u * Math.PI * 2;
      const n = [Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi)];
      b.vertex(n.map((c) => c * 0.5), n, [u, v]);
    }
  }
  quads(b, lon, lat, 0);
  return b.done('sphere');
}

/** A unit cube, four vertices per face so each face has its own normal. */
function box(): Mesh {
  const b = new Builder();
  const faces: [number[], number[], number[]][] = [
    // normal, right, up
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  ];
  for (const [n, r, up] of faces) {
    const base = b.p.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = [0, 1, 2].map((k) => 0.5 * n[k] + (u - 0.5) * r[k] + (0.5 - v) * up[k]);
      b.vertex(p, n, [u, v]);
    }
    b.i.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  return b.done('box');
}

/** Two triangles per grid cell, counter-clockwise seen from the front. */
function quads(b: Builder, cols: number, rows: number, base: number): void {
  const row = cols + 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = base + y * row + x;
      b.i.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
}
