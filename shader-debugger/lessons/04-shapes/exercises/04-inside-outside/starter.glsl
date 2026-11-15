precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv - 0.5;
  float sd = length(p) - 0.3;   // < 0 inside, 0 on the edge, > 0 outside

  vec3 inside = vec3(0.2, 0.4, 0.9);
  vec3 outside = vec3(0.95, 0.6, 0.3);

  vec3 col = outside;   // color by side, then add the outline

  fragColor = vec4(col, 1.0);
}
