# Rotation and polar coordinates

p5 has `rotate(angle)`. A shader rotates the other way around: instead of turning the shape, it turns the **coordinates** each pixel uses to look the shape up. A 2 × 2 matrix does that in one multiplication.

Then a second way to describe a position: not *x and y*, but **how far** from the center and **which direction**. `length(p)` and `atan(p.y, p.x)` give you those two numbers, called polar coordinates, and they make round and radial patterns easy: pie slices, spirals, flowers.

All angles here are in **radians**: a full turn is 2π ≈ 6.28.
