# Patterns and tiling

In p5 you'd draw a grid with two nested `for` loops. A shader can't loop over the canvas. Instead, it rewrites each pixel's coordinates so that every tile gets the same 0..1 range, and one drawing repeats in all of them.

`fract(x)` keeps just the part after the decimal point, so multiplying uv by 4 and taking `fract` gives you 0..1 *inside each of 4 × 4 tiles*. `floor(x)` keeps the whole part, which tells you **which** tile you're in. With these two you'll build a grid of circles, a checkerboard and a brick wall.
