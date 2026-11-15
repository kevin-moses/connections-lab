precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  float column = floor(uv.x * 8.0);   // 0 .. 7
  float row = floor(uv.y * 8.0);      // 0 .. 7
  float cell = mod(column + row, 2.0);

  fragColor = vec4(vec3(cell), 1.0);
}
