Key idea: -1..1 → 0..1 is `* 0.5 + 0.5` (inverse of `* 2 - 1`). Clamping hides out-of-range values silently.
Common mistakes: abs(v) (V shape, not a ramp: the increasing test catches it); clamp(v, 0.0, 1.0) (still black on the left); `v + 1.0` (0..2: right half saturates white).
Nudges: ask what v is at the left edge and what it needs to be there; ask what range `v + 1.0` gives.
