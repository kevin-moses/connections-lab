precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 left = vec3(0.1, 0.2, 0.6);
  vec3 right = vec3(1.0, 0.6, 0.2);

  vec3 col = left;  // blend from left to right here
  fragColor = vec4(col, 1.0);
}
