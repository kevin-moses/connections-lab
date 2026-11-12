# step & thresholds

In p5 you'd write `if (mouseX > 200) fill(255); else fill(0);`. Shaders have `if` too, but the usual tool is **`step(edge, x)`**: it returns **0.0** when `x` is below `edge` and **1.0** when it's at or above.

Because the result is just a number, you can **combine steps with math**. Multiply two for "both" (AND), and use `1.0 - step(…)` for "not". That's enough to build bands, rectangles and your first shape function.

Then `smoothstep` softens the hard edge into a ramp.
