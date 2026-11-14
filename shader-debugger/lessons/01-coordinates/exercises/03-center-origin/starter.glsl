precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // remap uv to -1..1 here

  fragColor = vec4(uv, 0.0, 1.0);
}
