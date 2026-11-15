precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

mat2 rotate2d(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv - 0.5;

  vec2 q = p;   // the bar's own coordinates
  float d = max(abs(q.x) - 0.3, abs(q.y) - 0.06);   // < 0 inside a 0.6 x 0.12 bar
  float bar = 1.0 - smoothstep(0.0, 0.005, d);

  fragColor = vec4(vec3(bar), 1.0);
}
