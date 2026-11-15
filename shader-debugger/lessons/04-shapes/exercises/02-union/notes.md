Key idea: combine distances, then threshold once. The minimum of two distances is the union of the shapes (maximum is the intersection).
Common mistakes: max instead of min (only the lens where both overlap remains); clamping the sum (removes the seam but keeps two separate edges, and the image check still differs on soft edges); taking min of the two already-drawn shapes (that's an intersection of the masks).
Nudges: ask which center a pixel between them is closer to; have them inspect d1 and d2 and then the combined distance in Diverging mode.
