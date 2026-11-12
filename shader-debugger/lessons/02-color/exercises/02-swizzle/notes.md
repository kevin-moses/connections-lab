Key idea: swizzles reorder/repeat components; vec4(vec3, float) builds a vec4.
Common mistakes: `uv.yxx` with an extra component in vec4 (vec4(uv.yxx, 0.0, 1.0) is too many components and won't compile); mixing rgba and xyzw letters in one swizzle (not allowed).
Nudges: ask which uv component grows upward (y) and which channel should carry it (red, the first).
