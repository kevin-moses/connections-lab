## Soft edges with smoothstep

`step` gives hard, jagged edges. `smoothstep(a, b, x)` returns 0 below `a`, 1 above `b`, and a smooth S-shaped ramp in between.

The starter draws a hard-edged circle from `d`, the distance to the center. Soften it: replace the `step` so the circle is white inside **d = 0.25** and fades to black by **d = 0.35**.

Try Inspect values on `d`, then on `circle`, in both **Raw** and **Diverging** modes.
