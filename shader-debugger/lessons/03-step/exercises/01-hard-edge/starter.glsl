precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float s = step(0.5, uv.x);
  fragColor = vec4(vec3(s), 1.0);
}
