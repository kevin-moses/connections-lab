precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv - 0.5;            // relative to the center

  float d = length(p);          // circle distance
  float shape = 1.0 - smoothstep(0.195, 0.205, d);

  fragColor = vec4(vec3(shape), 1.0);
}
