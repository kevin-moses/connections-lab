precision highp float;

out vec4 fragColor;

void main() {
  float red = gl_FragCoord.x / 400.0;
  fragColor = vec4(red, 0.0, 0.0, 1.0);
}
