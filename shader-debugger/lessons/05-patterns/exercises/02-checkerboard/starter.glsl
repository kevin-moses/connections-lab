precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  float column = floor(uv.x * 8.0);   // 0 .. 7
  float cell = mod(column, 2.0);      // 0, 1, 0, 1, ...

  fragColor = vec4(vec3(cell), 1.0);
}
