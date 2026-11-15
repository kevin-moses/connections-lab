precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start (Hydra calls it time)

out vec4 fragColor;

vec4 osc(vec2 st, float frequency, float sync, float offset) {
  float x = st.x + u_time * sync;      // the stripes drift sideways over time
  float shift = offset / frequency;    // red and blue are pushed apart by this much
  float r = 0.5 + 0.5 * sin((x - shift) * frequency);
  float g = 0.5 + 0.5 * sin(x * frequency);
  float b = 0.5 + 0.5 * sin((x + shift) * frequency);
  return vec4(r, g, b, 1.0);
}

// Hydra: rotate(angle = 10, speed = 0)
vec2 rotate(vec2 st, float angle, float speed) {
  float a = angle + speed * u_time;
  vec2 p = st - 0.5;   // around the middle
  p = vec2(cos(a) * p.x + sin(a) * p.y, -sin(a) * p.x + cos(a) * p.y);
  return p + 0.5;
}

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution;
  fragColor = osc(rotate(st, 0.785, 0.0), 10.0, 0.0, 0.0);   // Hydra: osc(10, 0, 0).rotate(0.785)
}
