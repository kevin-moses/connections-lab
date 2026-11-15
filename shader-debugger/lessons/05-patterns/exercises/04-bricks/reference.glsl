precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 st = uv * vec2(4.0, 8.0);   // 4 bricks across, 8 rows
  st.x += 0.5 * mod(floor(st.y), 2.0);   // odd rows: half a brick over

  vec2 f = fract(st);              // where in the brick
  float brick = step(0.05, f.x) * step(0.1, f.y);   // 0 on the mortar lines

  vec3 mortar = vec3(0.85, 0.82, 0.78);
  vec3 clay = vec3(0.7, 0.3, 0.2);
  fragColor = vec4(mix(mortar, clay, brick), 1.0);
}
