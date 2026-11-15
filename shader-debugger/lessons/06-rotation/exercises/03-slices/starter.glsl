precision highp float;

uniform vec2 u_resolution;  // canvas size in pixels

out vec4 fragColor;

const float TAU = 6.2831853;   // a full turn in radians

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv - 0.5;
  float a = atan(p.y, p.x);    // -pi .. pi, counter-clockwise from the right

  float shade = a / TAU + 0.5; // 0 .. 1 around the circle

  fragColor = vec4(vec3(shade), 1.0);
}
