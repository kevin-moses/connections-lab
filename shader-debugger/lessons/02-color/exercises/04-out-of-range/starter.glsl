precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float wave = sin(uv.x * 20.0);   // -1 .. 1: stripes

  vec3 deep = vec3(0.1, 0.2, 0.6);
  vec3 warm = vec3(1.0, 0.6, 0.2);
  vec3 col = mix(deep, warm, wave);

  fragColor = vec4(col, 1.0);
}
