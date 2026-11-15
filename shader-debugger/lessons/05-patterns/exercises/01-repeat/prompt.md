## Repeat it

The starter draws one soft circle in the middle of the canvas, using `uv` (0..1).

Multiply uv by 4 and take `fract`, and you get coordinates that run 0..1 **inside each tile** of a 4 × 4 grid. Draw the same circle with those coordinates instead, so there's one circle (radius 0.3 of a tile) in every tile: 16 circles.

Inspect your tile coordinate to see it repeat.
