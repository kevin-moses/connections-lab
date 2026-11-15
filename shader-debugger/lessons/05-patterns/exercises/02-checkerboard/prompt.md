## Checkerboard

`floor(uv.x * 8.0)` is the **column** a pixel is in: 0, 1, 2, … 7. `mod(column, 2.0)` is 0 for even columns and 1 for odd ones, which is how the starter draws stripes.

Make an 8 × 8 **checkerboard** instead, with a black square in the bottom-left corner. (Hint: a square is white when its column and row add up to an odd number.)
