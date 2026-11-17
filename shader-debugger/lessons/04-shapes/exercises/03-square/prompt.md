## A square from distance

`length` measures straight-line distance, so all the points at one distance form a circle. Measure it differently and you get a different shape.

`p` is the position relative to the center. `max(abs(p.x), abs(p.y))` is the larger of the horizontal and vertical distances. Points where that equals 0.2 form a **square**, not a circle.

Change `d` so the starter's circle becomes a square with half-width 0.2, and keep the same soft edge.
