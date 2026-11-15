precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start (Hydra calls it time)

out vec4 fragColor;

// Hydra: osc(frequency = 60, sync = 0.1, offset = 0)
vec4 osc(vec2 st, float frequency, float sync, float offset) {
  float x = st.x + u_time * sync;
  float shift = offset / frequency;
  float r = 0.5 + 0.5 * sin((x - shift) * frequency);
  float g = 0.5 + 0.5 * sin(x * frequency);
  float b = 0.5 + 0.5 * sin((x + shift) * frequency);
  return vec4(r, g, b, 1.0);
}

// Hydra: rotate(angle = 10, speed = 0), around the middle
vec2 rotate(vec2 st, float angle, float speed) {
  float a = angle + speed * u_time;
  vec2 p = st - 0.5;
  p = vec2(cos(a) * p.x + sin(a) * p.y, -sin(a) * p.x + cos(a) * p.y);
  return p + 0.5;
}

// Hydra: repeat(repeatX = 3, repeatY = 3), without its row offsets
vec2 repeat(vec2 st, float repeatX, float repeatY) {
  return fract(st * vec2(repeatX, repeatY));
}

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution;
  // Hydra: osc(20, 0, 0).rotate(0.8).repeat(3, 3)
  fragColor = osc(rotate(repeat(st, 3.0, 3.0), 0.8, 0.0), 20.0, 0.0, 0.0);
}
