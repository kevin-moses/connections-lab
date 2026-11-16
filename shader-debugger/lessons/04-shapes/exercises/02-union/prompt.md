## Two shapes as one

The starter has two discs, with `d1` and `d2` the distances to their centers. It draws each one separately and adds them. Where the soft edges overlap, the brightness adds up and you get a bright seam.

Instead, combine the **distances** first, then draw once. A pixel belongs to the merged shape if it's close to *either* center, so take the smaller of the two distances. Draw that with the same `1.0 - smoothstep(0.19, 0.21, …)` edge.

(With `max` instead, you'd get only the part where they overlap. Try it after.)
