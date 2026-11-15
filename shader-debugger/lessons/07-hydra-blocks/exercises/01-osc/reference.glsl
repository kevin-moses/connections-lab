precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start (Hydra calls it time)

out vec4 fragColor;

// Hydra: osc(frequency = 60, sync = 0.1, offset = 0)
vec4 osc(vec2 st, float frequency, float sync, float offset) {
  float x = st.x + u_time * sync;      // the stripes drift sideways over time
  float shift = offset / frequency;    // red and blue are pushed apart by this much
  float r = 0.5 + 0.5 * sin((x - shift) * frequency);
  float g = 0.5 + 0.5 * sin(x * frequency);
  float b = 0.5 + 0.5 * sin((x + shift) * frequency);
  return vec4(r, g, b, 1.0);
}

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution;
  fragColor = osc(st, 10.0, 0.1, 1.5);   // Hydra: osc(10, 0.1, 1.5)
}
