precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 tile = fract(uv * 4.0);   // 0..1 inside each of 4 x 4 tiles

  float d = length(tile - 0.5);
  float circle = 1.0 - smoothstep(0.28, 0.3, d);

  fragColor = vec4(vec3(circle), 1.0);
}
