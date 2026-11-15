Key idea: abs(d - r) is the (unsigned) distance to a circle's edge, so thresholding it gives an outline of any thickness.
Common mistakes: smoothstep with the edges reversed (smoothstep(0.02, 0.01, ...) is undefined behaviour and may look inverted); forgetting abs (only the outside half of the ring shows); using d - 0.3 directly as the brightness; thresholds too thin to see.
Nudges: ask what d is on the edge, just inside and just outside; have them inspect the edge distance in Diverging mode and look for the line at zero.
