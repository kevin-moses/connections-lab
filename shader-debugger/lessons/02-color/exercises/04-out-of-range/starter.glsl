precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start
uniform vec2  u_mouse;       // mouse position in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float v = uv.x * 2.0 - 1.0;   // -1 .. 1

  // remap v into 0..1 here

  fragColor = vec4(vec3(v), 1.0);
}
