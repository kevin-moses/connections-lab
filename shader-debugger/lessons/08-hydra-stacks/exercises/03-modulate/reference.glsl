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

// Hydra: modulate(amount = 0.1), uses a color to move coordinates
vec2 modulate(vec2 st, vec4 c, float amount) {
  return st + c.rg * amount;
}

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution;
  // Hydra: osc(20, 0, 0).modulate(osc(4, 0, 0).rotate(1.5708), 0.15)
  vec4 bend = osc(rotate(st, 1.5708, 0.0), 4.0, 0.0, 0.0);
  fragColor = osc(modulate(st, bend, 0.15), 20.0, 0.0, 0.0);
}
