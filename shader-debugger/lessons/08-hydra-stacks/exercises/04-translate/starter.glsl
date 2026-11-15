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

// Hydra: kaleid(nSides = 4). Like Hydra, it does not add 0.5 back.
vec2 kaleid(vec2 st, float nSides) {
  vec2 p = st - 0.5;
  float w = 6.2831853 / nSides;
  float a = abs(mod(atan(p.y, p.x), w) - w / 2.0);
  return length(p) * vec2(cos(a), sin(a));
}

// Hydra: color(r = 1, g = 1, b = 1), for amounts of 0 and up: scales each channel
vec4 color(vec4 c, float r, float g, float b) {
  return vec4(c.rgb * vec3(r, g, b), c.a);
}

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution;
  // Hydra: osc(30, 0.1, 1.2).kaleid(5).rotate(0, 0.3).color(1.0, 0.6, 0.9)
  fragColor = osc(st, 30.0, 0.1, 1.2);
}
