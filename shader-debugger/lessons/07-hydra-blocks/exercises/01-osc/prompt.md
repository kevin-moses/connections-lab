## osc: Hydra's first source

`osc(frequency, sync, offset)` is the first thing most Hydra sketches use: soft vertical stripes made from a sine wave, drifting sideways, with the red and blue channels slightly out of step for a rainbow fringe.

Write it. For each pixel, with `x = st.x + u_time * sync`:

- **green** is `0.5 + 0.5 * sin(x * frequency)`: a sine wave squeezed into 0..1
- **red** is the same wave shifted back by `offset / frequency`, **blue** shifted forward by it
- alpha is 1

`main` already calls it like Hydra's `osc(10, 0.1, 1.5)`. **Function tests** check `osc` at u_time = 0.
