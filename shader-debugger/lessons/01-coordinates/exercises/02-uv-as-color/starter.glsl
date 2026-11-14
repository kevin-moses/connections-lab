precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  // position as 0..1 across and up the canvas
  vec2 uv = gl_FragCoord.xy / u_resolution;
  fragColor = vec4(uv, 0.0, 1.0);
}
