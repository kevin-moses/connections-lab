Key idea: a signed distance gives the side (its sign) and the distance to the edge (its absolute value) at once; step(0.0, sd) picks the side, abs(sd) draws the outline.
Common mistakes: step(sd, 0.0) (sides swapped: blue outside); drawing the outline with sd instead of abs(sd) (only the inside half); adding the line color instead of mixing (overflows past white, and the colors around it shift); using if/else (works, but the image's soft line still needs the smoothstep).
Nudges: ask what sign sd has at the center and at a corner; have them inspect sd in Diverging mode and find the zero line.
