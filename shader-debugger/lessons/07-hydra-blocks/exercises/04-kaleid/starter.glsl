precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start (Hydra calls it time)

out vec4 fragColor;

const float TAU = 6.2831853;   // a full turn

vec4 osc(vec2 st, float frequency, float sync, float offset) {
  float x = st.x + u_time * sync;      // the stripes drift sideways over time
  float shift = offset / frequency;    // red and blue are pushed apart by this much
  float r = 0.5 + 0.5 * sin((x - shift) * frequency);
  float g = 0.5 + 0.5 * sin(x * frequency);
  float b = 0.5 + 0.5 * sin((x + shift) * frequency);
  return vec4(r, g, b, 1.0);
}

// Hydra: kaleid(nSides = 4)
vec2 kaleid(vec2 st, float nSides) {
  return st;
}

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution;
  fragColor = osc(kaleid(st, 4.0), 20.0, 0.0, 0.0);   // Hydra: osc(20, 0, 0).kaleid(4)
}
