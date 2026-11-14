precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

void main() {
  fragColor = vec4(1.0, 128.0 / 255.0, 0.0, 1.0);
}
