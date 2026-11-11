import { DEFAULT_SHADER } from '../defaultShader';

const HEADER = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
out vec4 fragColor;
`;

/** Shaders the self-test runs through both the interpreter and the GPU. */
export const CORPUS: { name: string; source: string }[] = [
  { name: 'default example', source: DEFAULT_SHADER },
  {
    name: 'uv gradient',
    source: HEADER + `void main() { vec2 uv = gl_FragCoord.xy / u_resolution; fragColor = vec4(uv, 0.5, 1.0); }`,
  },
  {
    name: 'circle sdf + smoothstep',
    source: HEADER + `
float circle(vec2 p, float r) { return length(p) - r; }
void main() {
  vec2 p = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  float d = circle(p, 0.5 + 0.1 * sin(u_time));
  vec3 col = mix(vec3(0.1, 0.3, 0.8), vec3(0.9, 0.5, 0.2), smoothstep(-0.01, 0.01, d));
  col *= 0.8 + 0.2 * cos(40.0 * d);
  fragColor = vec4(col, 1.0);
}`,
  },
  {
    name: 'rect with step',
    source: HEADER + `
float rect(vec2 uv, vec2 lo, vec2 hi) {
  vec2 s = step(lo, uv) * (1.0 - step(hi, uv));
  return s.x * s.y;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  fragColor = vec4(vec3(rect(uv, vec2(0.2), vec2(0.8))), 1.0);
}`,
  },
  {
    name: 'loops + value noise',
    source: HEADER + `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x), u.y);
}
void main() {
  vec2 p = gl_FragCoord.xy / u_resolution.y * 4.0;
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  fragColor = vec4(vec3(v), 1.0);
}`,
  },
  {
    name: 'rotation matrix',
    source: HEADER + `
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
void main() {
  vec2 p = gl_FragCoord.xy / u_resolution - 0.5;
  p = rot(u_time * 0.3) * p;
  mat3 m = mat3(1.0, 0.2, 0.0, 0.0, 1.0, 0.3, 0.1, 0.0, 1.0);
  vec3 c = m * vec3(p, 1.0);
  fragColor = vec4(fract(c * 3.0), 1.0);
}`,
  },
  {
    name: 'ints, bits and loops with break',
    source: HEADER + `
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy) / 16;
  int checker = (cell.x + cell.y) % 2;
  int bits = (cell.x ^ cell.y) & 7;
  int steps = 0;
  for (int i = 0; i < 20; i++) { if (i * i > cell.x) break; steps++; }
  fragColor = vec4(float(checker), float(bits) / 7.0, float(steps) / 20.0, 1.0);
}`,
  },
  {
    name: 'out / inout params',
    source: HEADER + `
void polar(vec2 p, out float r, out float a) { r = length(p); a = atan(p.y, p.x); }
void bump(inout vec3 c, float k) { c += k; }
void main() {
  vec2 p = gl_FragCoord.xy / u_resolution - 0.5;
  float r; float a;
  polar(p, r, a);
  vec3 c = vec3(r, a / 6.2831853 + 0.5, 0.0);
  bump(c, 0.1);
  fragColor = vec4(c, 1.0);
}`,
  },
  {
    name: 'pattern with mod/fract/floor',
    source: HEADER + `
#define TILES 6.0
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution * TILES;
  vec2 id = floor(uv);
  vec2 gv = fract(uv) - 0.5;
  float flip = mod(id.x + id.y, 2.0);
  float d = abs(gv.x + (flip > 0.5 ? gv.y : -gv.y));
  fragColor = vec4(vec3(smoothstep(0.05, 0.0, d)), 1.0);
}`,
  },
  {
    name: 'discard ring',
    source: HEADER + `
void main() {
  vec2 p = gl_FragCoord.xy / u_resolution - 0.5;
  float r = length(p);
  if (r > 0.3 && r < 0.35) discard;
  fragColor = vec4(r, 0.0, 1.0 - r, 1.0);
}`,
  },
];
