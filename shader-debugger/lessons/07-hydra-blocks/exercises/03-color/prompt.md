## Color functions, in order

Color functions take the **color** a source made and change it: `vec4 f(vec4 c, …)`. They run *after* the source, in the order you write them. Hydra's `osc(8).brightness(0.2).invert()` makes osc's color, brightens it, then inverts the result. In GLSL that's `invert(brightness(osc(…), 0.2), 1.0)`.

Write two of Hydra's color functions (they leave alpha alone):

- `brightness(c, amount)` adds `amount` to red, green and blue. (Don't clamp. The screen clamps at the end.)
- `invert(c, amount)` blends each channel toward `1.0 - channel`: all the way at amount 1, halfway at 0.5.

Then make `main` match the Hydra line in its comment.
