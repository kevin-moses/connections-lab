precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float d = length(uv - 0.5);   // distance from the center

  float edge = abs(d - 0.3);    // distance from the circle's edge
  float shape = 1.0 - smoothstep(0.01, 0.02, edge);

  fragColor = vec4(vec3(shape), 1.0);
}
