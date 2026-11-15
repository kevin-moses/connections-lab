## A flower

In polar coordinates a circle is simple: everything with `r` below the radius. Make the radius depend on the **angle** and the outline changes shape.

The starter draws a disc of radius 0.25 from `r` and `a`. Give it **five petals**: let the edge radius swing between 0.17 and 0.33 as you go around, `0.25 + 0.08 * cos(5 × angle)`, so a petal points straight right (a = 0).

Inspect `a`, then your edge radius, to see what each pixel compares against.
