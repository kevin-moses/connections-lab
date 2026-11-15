## Slices

`atan(p.y, p.x)` is the **angle** of `p`, measured counter-clockwise from the right: 0 pointing right, π/2 up, ±π left, −π/2 down. The starter shows it as gray (dark → light going counter-clockwise from the left).

Cut the canvas into **12 slices**, alternating black and white like a beach ball: each slice spans 30°, starting with a **black** one just above the right-pointing direction (0° to 30°).

(How many full "black + white" pairs fit in a turn? Turn the angle into that many repeats, then `fract` and `step`.)
