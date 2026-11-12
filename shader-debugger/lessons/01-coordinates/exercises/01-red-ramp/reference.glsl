precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start
uniform vec2  u_mouse;       // mouse position in pixels

out vec4 fragColor;

void main() {
  float red = gl_FragCoord.x / u_resolution.x;
  fragColor = vec4(red, 0.0, 0.0, 1.0);
}
