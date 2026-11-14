precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float left = step(0.3, uv.x);   // 1 to the right of 0.3
  float band = left * (1.0 - step(0.7, uv.x));
  fragColor = vec4(vec3(band), 1.0);
}
