## A rotation matrix

Write `rotate2d(a)` so that `rotate2d(a) * v` turns the vector `v` **counter-clockwise** by `a` radians. The rotated x axis is `(cos a, sin a)` and the rotated y axis is `(−sin a, cos a)`.

`mat2(a, b, c, d)` fills the matrix **column by column**, which surprises most people. The first two numbers are the first column, which is where the rotated x axis goes.

The starter uses it to turn the square's coordinates by 45°, which should make a diamond once `rotate2d` works. **Function tests** call `rotate2d` directly; step into any that fail.
