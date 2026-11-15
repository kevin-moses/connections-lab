precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float d1 = length(uv - vec2(0.38, 0.5));
  float d2 = length(uv - vec2(0.62, 0.5));

  float shape = (1.0 - smoothstep(0.19, 0.21, d1))
              + (1.0 - smoothstep(0.19, 0.21, d2));

  fragColor = vec4(vec3(shape) * vec3(1.0, 0.6, 0.3), 1.0);
}
