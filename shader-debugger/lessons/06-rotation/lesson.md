# Rotation and polar coordinates

p5 has `rotate(angle)`. A shader turns the **coordinates** each pixel uses to look up the shape, not the shape itself. A 2 × 2 matrix does that in one multiplication.

The lesson also describes a position by **how far** it is from the center and in **which direction**, instead of by *x and y*. `length(p)` and `atan(p.y, p.x)` give you those two numbers, called polar coordinates. They make radial patterns like pie slices and flowers easy to write.

All angles here are in **radians**, so a full turn is 2π, about 6.28.
