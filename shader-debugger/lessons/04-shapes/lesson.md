# Shapes with distance

In lesson 3 you drew a circle from `length(uv - 0.5)`: every pixel's **distance** to the center. If you can measure how far a pixel is from a shape, you can draw the shape, its outline, a glow around it, or two shapes merged into one, using `abs`, `min`, `max` and `smoothstep` on that distance.

To see the distances, use **Inspect values** in **Diverging** mode. It shows values below zero in blue and values above zero in red, with a line at zero.
