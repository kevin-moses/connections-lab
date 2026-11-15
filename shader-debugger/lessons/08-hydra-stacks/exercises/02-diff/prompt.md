## Combining two chains

Hydra's `osc(10, 0, 0).diff(shape(4, 0.5, 0.01))` makes osc's stripes, makes a square, and combines the two **colors** with `diff`: the absolute difference of each channel. Where the square is black (0), you see the stripes; where it's white (1), you see them inverted.

Write `diff(a, b)` like Hydra's: `abs(a.rgb - b.rgb)` for color, and the larger of the two alphas. Then make `main` compute both chains at the same `st` and combine them.
