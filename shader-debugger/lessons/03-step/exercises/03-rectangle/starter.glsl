precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float bandX = step(0.2, uv.x) * (1.0 - step(0.8, uv.x));
  float bandY = 1.0;    // y between 0.3 and 0.6
  float rect = bandX;   // combine the two bands
  fragColor = vec4(vec3(rect), 1.0);
}
