precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start
uniform vec2  u_mouse;       // mouse position in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution * 2.0 - 1.0;
  // fix the aspect ratio here

  float d = length(uv);
  fragColor = vec4(vec3(1.0 - d), 1.0);
}
