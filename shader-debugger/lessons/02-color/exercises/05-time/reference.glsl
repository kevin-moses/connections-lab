precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start
uniform vec2  u_mouse;       // mouse position in pixels

out vec4 fragColor;

void main() {
  float pulse = sin(u_time) * 0.5 + 0.5;
  fragColor = vec4(pulse, 0.2, 0.3, 1.0);
}
