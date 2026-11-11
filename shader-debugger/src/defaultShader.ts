export const DEFAULT_SHADER = `precision highp float;

uniform vec2  u_resolution;  // canvas size in pixels
uniform float u_time;        // seconds since start
uniform vec2  u_mouse;       // mouse in pixels, origin bottom-left

out vec4 fragColor;

void main() {
  // 0..1 across the canvas, (0,0) at the bottom-left
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // a slowly cycling gradient
  vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0.0, 2.0, 4.0));

  // darken near the mouse
  float d = length(gl_FragCoord.xy - u_mouse) / u_resolution.y;
  col *= smoothstep(0.0, 0.25, d);

  fragColor = vec4(col, 1.0);
}
`;
