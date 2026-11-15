Key idea: combine functions take two colors (vec4, vec4) -> vec4: both chains are evaluated at the same st and their results are combined; diff is the per-channel absolute difference.
Common mistakes: subtracting without abs (inside the square goes negative: black); diffing alpha too; passing st instead of the shape's color; calling shape(osc(...)) (type error).
Nudges: ask what diff does with black and with white; have them click a pixel inside the square and step into diff.
