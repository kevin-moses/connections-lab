## A square from distance

`length` measures distance "as the crow flies", so equal distances make a circle. Measure it differently and you get a different shape.

`p` is the position relative to the center. `max(abs(p.x), abs(p.y))` is the bigger of the two sideways distances. Points where that equals 0.2 form a **square**, not a circle.

Change `d` so the starter's circle becomes a square with half-width 0.2, keeping the same soft edge.
