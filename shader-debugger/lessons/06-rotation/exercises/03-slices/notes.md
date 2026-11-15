Key idea: atan(y, x) gives the angle in radians; dividing by a full turn and multiplying by n gives n repeats around the circle, then fract/step make alternating slices (the same repeat trick as fract(uv * n), but around a circle).
Common mistakes: dividing by π instead of 2π (twice as many slices); using a single-argument atan(p.y / p.x) (only covers half the circle, slices mirror); step(fract(...), 0.5) (colors swapped: the 15° test fails); degrees.
Nudges: ask what a is at 0°, 30°, 60°, and what the expression inside fract should be at those angles; have them inspect it in Auto mode.
