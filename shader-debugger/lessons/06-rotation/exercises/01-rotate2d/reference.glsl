precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

mat2 rotate2d(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);   // columns: where x goes, where y goes
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv - 0.5;

  vec2 q = rotate2d(0.785398) * p;   // turned by 45 degrees
  float d = max(abs(q.x), abs(q.y));
  float shape = 1.0 - smoothstep(0.195, 0.205, d);

  fragColor = vec4(vec3(shape), 1.0);
}
