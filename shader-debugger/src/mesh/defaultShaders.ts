/** What mesh mode starts with: a gentle wave on the mesh, lit by its normals. p5's attribute and matrix names. */

export const DEFAULT_VERTEX = `precision highp float;

// Per vertex, from the mesh (p5's names).
in vec3 aPosition;
in vec3 aNormal;
in vec2 aTexCoord;

// The camera, from the app.
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat3 uNormalMatrix;
uniform float u_time;        // seconds since start

// Handed to the fragment shader, blended across each triangle.
out vec3 vNormal;
out vec2 vTexCoord;

void main() {
  vec3 pos = aPosition;
  float wave = sin(pos.x * 12.0 + u_time * 2.0);
  pos += aNormal * 0.04 * wave;   // push out along the normal

  vNormal = uNormalMatrix * aNormal;
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(pos, 1.0);
}
`;

export const DEFAULT_FRAGMENT = `precision highp float;

in vec3 vNormal;
in vec2 vTexCoord;

out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 toLight = normalize(vec3(0.4, 0.6, 0.7));
  float light = 0.35 + 0.65 * max(dot(n, toLight), 0.0);
  // Warm at the top, cool at the bottom (vTexCoord.y runs 0 → 1 down the mesh).
  vec3 base = mix(vec3(0.95, 0.55, 0.25), vec3(0.3, 0.45, 0.95), vTexCoord.y);
  fragColor = vec4(base * light, 1.0);
}
`;
