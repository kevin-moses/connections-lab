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

const float TAU = 6.2831853;

// Hydra: shape(sides = 3, radius = 0.3, smoothing = 0.01). White inside a regular polygon.
vec4 shape(vec2 st, float sides, float radius, float smoothing) {
  vec2 p = st * 2.0 - 1.0;               // -1..1 across the canvas
  float a = atan(p.x, p.y) + TAU / 2.0;  // angle, measured from straight up
  float w = TAU / sides;                 // angle per side
  // How far out p reaches toward the middle of the nearest side:
  float d = cos(floor(0.5 + a / w) * w - a) * length(p);
  return vec4(vec3(1.0 - smoothstep(radius, radius + smoothing, d)), 1.0);
}

// Hydra: diff(), combines two colors
vec4 diff(vec4 a, vec4 b) {
  return vec4(abs(a.rgb - b.rgb), max(a.a, b.a));
}

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution;
  // Hydra: osc(10, 0, 0).diff(shape(4, 0.5, 0.01))
  fragColor = diff(osc(st, 10.0, 0.0, 0.0), shape(st, 4.0, 0.5, 0.01));
}
