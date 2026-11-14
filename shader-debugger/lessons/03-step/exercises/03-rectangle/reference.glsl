precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float bandX = step(0.2, uv.x) * (1.0 - step(0.8, uv.x));
  float bandY = step(0.3, uv.y) * (1.0 - step(0.6, uv.y));
  float rect = bandX * bandY;
  fragColor = vec4(vec3(rect), 1.0);
}
