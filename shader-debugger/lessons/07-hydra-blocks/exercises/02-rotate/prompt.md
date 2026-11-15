## rotate: a coordinate transform

In Hydra, `osc(10).rotate(0.785)` turns the stripes by 0.785 radians (45°). You write `.rotate` *after* `osc`, but in the shader it runs **before**: it changes the position `st`, and `osc` then reads the changed position. So in GLSL it goes inside: `osc(rotate(st, …), …)`.

Write `rotate(st, angle, speed)` like Hydra's: turn `st` around the **middle of the canvas** by `angle + speed * u_time`. To turn the *picture* counter-clockwise, the coordinates turn the other way:

- `p = st - 0.5`, then `x' = cos(a)·p.x + sin(a)·p.y` and `y' = −sin(a)·p.x + cos(a)·p.y`, then add 0.5 back.

Then use it in `main` for Hydra's `osc(10, 0, 0).rotate(0.785)`.
