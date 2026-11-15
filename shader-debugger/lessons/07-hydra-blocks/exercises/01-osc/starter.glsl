precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start (Hydra calls it time)

out vec4 fragColor;

// Hydra: osc(frequency = 60, sync = 0.1, offset = 0)
vec4 osc(vec2 st, float frequency, float sync, float offset) {
  return vec4(0.0, 0.0, 0.0, 1.0);
}

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution;
  fragColor = osc(st, 10.0, 0.1, 1.5);   // Hydra: osc(10, 0.1, 1.5)
}
