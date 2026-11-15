## Inside, outside, and the edge

`length(p) - 0.3` is a **signed distance**: negative inside the circle, zero on the edge, positive outside. One number tells you which side you're on *and* how far. Inspect `sd` in **Diverging** mode to see it.

Use it to color the scene:

- **inside** (`sd < 0`): `inside`, a blue
- **outside**: `outside`, an orange
- and a white **outline** where `abs(sd)` is below 0.005, fading out by 0.01 (draw it on top).
