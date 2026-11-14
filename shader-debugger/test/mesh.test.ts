import { describe, expect, it } from 'vitest';
import { buildMesh, MESH_NAMES, vertexAttributes } from '../src/mesh/geometry';
import { lookAt, multiply, normalMatrix, perspective, transform } from '../src/mesh/mat4';
import { orbitMatrices } from '../src/mesh/camera';
import { prepareVertexSource } from '../src/glsl/prepare';
import { parseGlsl } from '../src/glsl/parse';
import { traceVertex } from '../src/interp/interpreter';
import { DEFAULT_VERTEX } from '../src/mesh/defaultShaders';

describe('built-in meshes', () => {
  it.each(MESH_NAMES)('%s: unit normals, in-range indices, texcoords 0..1, fits in a unit box', (name) => {
    const m = buildMesh(name);
    expect(m.positions.length).toBe(m.vertexCount * 3);
    expect(m.texcoords.length).toBe(m.vertexCount * 2);
    for (let i = 0; i < m.vertexCount; i++) {
      const n = m.normals.subarray(i * 3, i * 3 + 3);
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      for (const c of m.positions.subarray(i * 3, i * 3 + 3)) expect(Math.abs(c)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    for (const t of m.texcoords) expect(t >= 0 && t <= 1).toBe(true);
    expect(Math.max(...m.indices)).toBeLessThan(m.vertexCount);
    expect(m.indices.length % 3).toBe(0);
  });

  it("plane texcoords follow p5: (0, 0) at the top-left", () => {
    const a = vertexAttributes(buildMesh('plane'), 0);
    expect(a.aPosition).toEqual([-0.5, 0.5, 0]);
    expect(a.aTexCoord).toEqual([0, 0]);
    expect(a.aNormal).toEqual([0, 0, 1]);
  });

  it('triangles face their normals (counter-clockwise from the front)', () => {
    for (const name of MESH_NAMES) {
      const m = buildMesh(name);
      const p = (i: number) => Array.from(m.positions.subarray(i * 3, i * 3 + 3));
      let facing = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [p(m.indices[t]), p(m.indices[t + 1]), p(m.indices[t + 2])];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const n = Array.from(m.normals.subarray(m.indices[t] * 3, m.indices[t] * 3 + 3));
        const area = Math.hypot(...cross);
        if (area < 1e-9) continue; // the sphere's poles have degenerate triangles
        if (cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0) facing++;
        else facing--;
      }
      expect(facing, name).toBeGreaterThan(0);
    }
  });
});

describe('matrices', () => {
  it('projects the camera target to the middle of the screen', () => {
    const view = lookAt([1, 1, 2], [0, 0, 0], [0, 1, 0]);
    const clip = transform(multiply(perspective(Math.PI / 4, 1.5, 0.05, 50), view), [0, 0, 0, 1]);
    expect(clip[0] / clip[3]).toBeCloseTo(0, 6);
    expect(clip[1] / clip[3]).toBeCloseTo(0, 6);
    expect(clip[2] / clip[3]).toBeGreaterThan(-1);
    expect(clip[2] / clip[3]).toBeLessThan(1);
  });

  it('the normal matrix of a rotation is the rotation itself', () => {
    const view = lookAt([2, 0, 0], [0, 0, 0], [0, 1, 0]);
    const n = normalMatrix(view);
    const rot = [view[0], view[1], view[2], view[4], view[5], view[6], view[8], view[9], view[10]];
    n.forEach((x, i) => expect(x).toBeCloseTo(rot[i], 6));
  });
});

describe('the default mesh shader', () => {
  it('runs on the CPU and lands where the camera matrices put it', () => {
    const m = orbitMatrices(0.6, 0.45, 2, 1.5);
    const parsed = parseGlsl(DEFAULT_VERTEX);
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const mesh = buildMesh('plane');
    const centre = 12 * 25 + 12;
    const r = traceVertex(parsed.ast, {
      attributes: vertexAttributes(mesh, centre),
      vertexId: centre,
      uniforms: { u_time: 0, uModelViewMatrix: m.modelView, uProjectionMatrix: m.projection, uNormalMatrix: m.normal },
    });
    expect(r.error).toBeNull();
    // sin(0) = 0: the centre doesn't move at t = 0, so it projects to the screen centre.
    const [x, y, , w] = (r.output!.value as { data: number[] }).data;
    expect(x / w).toBeCloseTo(0, 4);
    expect(y / w).toBeCloseTo(0, 4);
  });
});

describe('prepareVertexSource', () => {
  it('adds #version to ES 3.00 vertex code', () => {
    const p = prepareVertexSource('in vec3 aPosition;\nvoid main() { gl_Position = vec4(aPosition, 1.0); }');
    expect(p.code.startsWith('#version 300 es\n')).toBe(true);
    expect(p.map.toSource(2)).toBe(1);
  });

  it('converts p5-style ES 1.00 vertex code like three.js, lines mapped back', () => {
    const src = 'attribute vec3 aPosition;\nvarying vec3 vPos;\nvoid main() { vPos = aPosition; gl_Position = vec4(aPosition, 1.0); }';
    const p = prepareVertexSource(src);
    expect(p.style).toBe('es100');
    const gen = p.code.split('\n');
    expect(gen[0]).toBe('#version 300 es');
    expect(gen).toContain('#define attribute in');
    expect(gen).toContain('#define varying out');
    src.split('\n').forEach((line, i) => expect(gen[p.map.toGenerated(i + 1)! - 1]).toBe(line));
  });
});
