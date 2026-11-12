precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start
uniform vec2  u_mouse;       // mouse position in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float s = step(u_mouse.x / u_resolution.x, uv.x);
  fragColor = vec4(vec3(s), 1.0);
}
