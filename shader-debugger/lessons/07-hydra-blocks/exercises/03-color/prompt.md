## Color functions, in order

Color functions take the **color** a source made and change it: `vec4 f(vec4 c, …)`. They run *after* the source, in the order you write them. Hydra's `osc(8).brightness(0.2).invert()` means: make osc's color, brighten it, then invert that: `invert(brightness(osc(…), 0.2), 1.0)`.

Write two of Hydra's color functions (they leave alpha alone):

- `brightness(c, amount)` adds `amount` to red, green and blue. (No clamping: the screen clamps at the end.)
- `invert(c, amount)` blends each channel toward `1.0 - channel`: all the way at amount 1, halfway at 0.5.

Then make `main` match the Hydra line in its comment.
