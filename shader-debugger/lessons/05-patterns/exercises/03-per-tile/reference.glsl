precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 tile = fract(uv * 4.0);   // where in the tile: 0..1
  vec2 id = floor(uv * 4.0);     // which tile: (0, 0) .. (3, 3)

  float r = 0.1 + 0.1 * id.x;
  float d = length(tile - 0.5);
  float circle = 1.0 - smoothstep(r - 0.01, r + 0.01, d);

  fragColor = vec4(vec3(circle), 1.0);
}
