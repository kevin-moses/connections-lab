## A different circle in every tile

`fract` makes every tile the same. `floor` tells them apart: `id = floor(uv * 4.0)` is (0, 0) for the bottom-left tile up to (3, 3) for the top-right.

Make the circles **grow from left to right**: radius **0.1** in the first column, then 0.2, 0.3 and **0.4** in the last (in tile units, as before). Keep the same soft edge, 0.01 on either side of the radius.
