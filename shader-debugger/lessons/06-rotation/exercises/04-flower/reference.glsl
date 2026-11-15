precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv - 0.5;
  float r = length(p);          // how far from the center
  float a = atan(p.y, p.x);     // which direction (radians)

  float edge = 0.25 + 0.08 * cos(5.0 * a);   // five petals
  float flower = 1.0 - smoothstep(edge - 0.01, edge + 0.01, r);

  fragColor = vec4(vec3(flower) * vec3(1.0, 0.75, 0.3), 1.0);
}
