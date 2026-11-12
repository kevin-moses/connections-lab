precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start
uniform vec2  u_mouse;       // mouse position in pixels

out vec4 fragColor;

float rect(vec2 uv, vec2 lo, vec2 hi) {
  vec2 inside = step(lo, uv) * (1.0 - step(hi, uv));
  return inside.x * inside.y;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float shapes = rect(uv, vec2(0.1), vec2(0.4)) + rect(uv, vec2(0.5), vec2(0.9, 0.8));
  fragColor = vec4(vec3(shapes), 1.0);
}
