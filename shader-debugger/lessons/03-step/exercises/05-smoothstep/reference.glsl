precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float d = length(uv - 0.5);         // distance from the center
  float circle = 1.0 - smoothstep(0.25, 0.35, d);
  fragColor = vec4(vec3(circle), 1.0);
}
