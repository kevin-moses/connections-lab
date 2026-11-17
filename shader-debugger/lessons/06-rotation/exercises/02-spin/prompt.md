## Spin it

The starter draws a bar lying flat: long in x, thin in y. Make it **spin counter-clockwise at 1 radian per second**, so at `u_time = 1.5708` (a quarter turn) it stands upright.

You'll need `u_time` again, so declare it as before.

Careful with the direction. As with sliding stripes in lesson 2, you move the **coordinates**, not the shape: to turn the bar counter-clockwise, each pixel has to look it up turned the *other* way. The checker looks at several moments.
