# Rotation and polar coordinates

p5 has `rotate(angle)`. A shader rotates the other way around: instead of turning the shape, it turns the **coordinates** each pixel uses to look the shape up. A 2 × 2 matrix does that in one multiplication.

The lesson also describes a position a second way: **how far** it is from the center and in **which direction**, instead of *x and y*. `length(p)` and `atan(p.y, p.x)` give you those two numbers, called polar coordinates, and they make round and radial patterns easy: pie slices, spirals, flowers.

All angles here are in **radians**: a full turn is 2π ≈ 6.28.
