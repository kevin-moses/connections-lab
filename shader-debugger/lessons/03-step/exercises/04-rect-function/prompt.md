## Your first function

You'll draw a lot of rectangles, so wrap the logic in a function:

```glsl
float rect(vec2 uv, vec2 lo, vec2 hi)
```

It should return **1.0 inside** the box from corner `lo` to corner `hi`, and **0.0 outside**.

Tip: `step` works on vectors one component at a time. `step(lo, uv)` gives a `vec2` with x and y handled at once. Combine the components at the end.

This exercise is checked with **function tests** that call your `rect()` directly. If one fails, click **Step into** to watch that exact call run.
