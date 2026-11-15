# Hydra's building blocks

[Hydra](https://hydra.ojack.xyz) (by Olivia Jack) lets you live-code visuals by chaining functions: `osc(10, 0.1, 1.5).rotate(0.5).invert()`. Behind the scenes, every one of those functions is a few lines of GLSL, and Hydra stitches them into one fragment shader for you.

They come in a few kinds, and the kind decides where the function goes in the shader:

- **Sources** make a color from a position: `vec4 osc(vec2 st, …)`.
- **Coordinate transforms** change the position *before* a source looks at it: `vec2 rotate(vec2 st, …)`.
- **Color functions** change a color *after* it's made: `vec4 invert(vec4 c, …)`.

In this lesson you'll write one of each, the way Hydra defines them. (Hydra's `st` is `gl_FragCoord.xy / resolution`, the same uv you've been using, and its `time` is our `u_time`.) The code is our own, written to behave like Hydra's.
