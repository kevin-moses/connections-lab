Key idea: smoothstep(a, b, x) is a smooth threshold; 1 - smoothstep makes "inside" bright.
Common mistakes: smoothstep(0.35, 0.25, d) (reversed edges: works on most GPUs but is undefined behaviour in GLSL; suggest 1 - smoothstep instead); forgetting the `1.0 -` (an inverted circle); passing (d, 0.25, 0.35) (wrong argument order).
Nudges: ask what smoothstep returns for d = 0 and for d = 0.5, and which one should be white.
