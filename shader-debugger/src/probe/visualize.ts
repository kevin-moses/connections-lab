/**
 * Display pass: turns the probe's raw float values into pixels.
 *
 * Modes
 *   0 raw        what the GPU would show: clamp to [0,1]. Out-of-range
 *                components get hatched: "/" cyan = below 0, "\" dark = above 1.
 *   1 diverging  blue < 0 < red, white at 0, with a zero contour. For SDFs.
 *   2 auto       min..max of the visible values stretched to black..white.
 *
 * Pixels that never reached the probe point show a dim checkerboard.
 */
export const VISUALIZE_FS = `#version 300 es
precision highp float;

uniform sampler2D u_value;
uniform sampler2D u_meta;
uniform int   u_mode;      // 0 raw, 1 diverging, 2 auto
uniform int   u_channel;   // -1 all, else 0..3
uniform vec2  u_range;     // auto: min, max
uniform float u_absMax;    // diverging: scale
uniform float u_scale;     // device pixel ratio

out vec4 outColor;

float stripes(vec2 p, float dir) {
  float period = 7.0 * u_scale;
  float t = (p.x + dir * p.y) / period;
  float f = abs(fract(t) - 0.5) * period;     // distance to line center, px
  return 1.0 - smoothstep(0.6 * u_scale, 1.4 * u_scale, f);
}

vec3 notReached(vec2 p) {
  vec2 c = floor(p / (10.0 * u_scale));
  float k = mod(c.x + c.y, 2.0);
  return vec3(0.075 + 0.03 * k);
}

vec3 byDim(vec4 v, int dim) {
  if (dim == 1) return vec3(v.x);
  if (dim == 2) return vec3(v.xy, 0.0);
  return v.rgb;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 v = texelFetch(u_value, px, 0);
  vec4 meta = texelFetch(u_meta, px, 0);     // hits, dim, kind, capturedAt
  vec2 p = gl_FragCoord.xy;

  if (meta.x <= 0.0 || meta.w <= 0.0) {     // discarded / never reached / iteration not reached
    outColor = vec4(notReached(p), 1.0);
    return;
  }

  int dim = int(meta.y + 0.5);
  if (u_channel >= 0) {
    v = vec4(v[u_channel], 0.0, 0.0, 0.0);
    dim = 1;
  }
  vec4 used = vec4(1.0, dim > 1 ? 1.0 : 0.0, dim > 2 ? 1.0 : 0.0, dim > 3 ? 1.0 : 0.0);

  vec3 col;
  if (u_mode == 1) {
    float s = clamp(v.x / max(u_absMax, 1e-6), -1.0, 1.0);
    vec3 neg = vec3(0.23, 0.49, 0.95);
    vec3 pos = vec3(0.93, 0.33, 0.25);
    col = s < 0.0 ? mix(vec3(0.97), neg, -s) : mix(vec3(0.97), pos, s);
    // zero contour
    float w = max(fwidth(v.x), 1e-6);
    float line = 1.0 - smoothstep(0.5, 1.5, abs(v.x) / w);
    col = mix(col, vec3(0.05), line);
    outColor = vec4(col, 1.0);
    return;
  }

  if (u_mode == 2) {
    float span = max(u_range.y - u_range.x, 1e-6);
    vec4 n = (v - u_range.x) / span;
    col = byDim(clamp(n, 0.0, 1.0), dim);
    if (dim == 4) col = byDim(clamp(n, 0.0, 1.0), 3);
    outColor = vec4(col, 1.0);
    return;
  }

  // raw
  vec4 c = clamp(v, 0.0, 1.0);
  col = byDim(c, dim);
  if (dim == 4) {
    vec2 cc = floor(p / (8.0 * u_scale));
    vec3 checker = vec3(mod(cc.x + cc.y, 2.0) * 0.2 + 0.4);
    col = mix(checker, c.rgb, c.a);
  }
  bool under = any(lessThan(v * used, vec4(0.0)));
  bool over  = any(greaterThan(v * used, vec4(1.0)));
  if (under) col = mix(col, vec3(0.30, 0.85, 1.0), 0.85 * stripes(p, 1.0));
  if (over)  col = mix(col, vec3(0.04), 0.75 * stripes(p, -1.0));
  outColor = vec4(col, 1.0);
}
`;
