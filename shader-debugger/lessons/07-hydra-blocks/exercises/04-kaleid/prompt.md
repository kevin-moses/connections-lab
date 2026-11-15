## kaleid: folding the angle

Hydra's `kaleid(nSides)` is a coordinate transform that turns anything into a kaleidoscope. It uses the polar coordinates from lesson 6:

1. `p = st - 0.5`, `r = length(p)`, `a = atan(p.y, p.x)`.
2. **Fold the angle** into one wedge of width `w = 2π / nSides` with `mod(a, w)`, then mirror it around the wedge's middle with `abs(… - w / 2.0)`.
3. Return the point at radius `r` in that folded direction: `r * vec2(cos(a), sin(a))`.

Like Hydra's, it doesn't add 0.5 back, so the source is read around (0, 0). `main` already does Hydra's `osc(20, 0, 0).kaleid(4)`.
