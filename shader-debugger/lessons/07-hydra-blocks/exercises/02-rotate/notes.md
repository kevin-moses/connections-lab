Key idea: coordinate transforms are vec2 -> vec2 functions applied to st before the source reads it, so a chain's .rotate() ends up inside the source call; rotating about the center means subtract 0.5, rotate, add 0.5.
Common mistakes: rotating about the corner (forgetting the 0.5s: the middle test fails); the sign of sin swapped (turns the picture clockwise: the quarter-turn tests fail); applying rotate to osc's output color instead of its input position; degrees.
Nudges: ask what osc reads at a pixel once st is rotated; have them step into the quarter-turn test and watch p before and after.
