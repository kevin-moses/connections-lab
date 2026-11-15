## Last written, first run

Hydra's `osc(20, 0, 0).rotate(0.8).repeat(3, 3)` makes a 3 × 3 grid where every tile has the same **tilted** stripes.

The starter nests the transforms in the order they're written, `osc(repeat(rotate(st)))`, and gets something else: one big set of tilted stripes, cut into a grid along the tilted lines.

Hydra applies coordinate transforms **last-written first**: `repeat` changes `st` first (into tile coordinates), then `rotate` turns each tile's coordinates around the tile's middle, then `osc` reads them. Fix the nesting in `main`.
