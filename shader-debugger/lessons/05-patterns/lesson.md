# Patterns and tiling

In p5 you'd draw a grid with two nested `for` loops. A shader can't loop over the canvas. Instead, it **folds space** so that every pixel thinks it's in the same small tile.

The tools: `fract(x)` keeps just the part after the decimal point, so multiplying uv by 4 and taking `fract` gives you 0..1 *inside each of 4 × 4 tiles*. `floor(x)` keeps the whole part, which tells you **which** tile you're in. Together they give you grids, checkerboards, bricks, and anything that repeats.
