Key idea: mix(a, b, t) is linear interpolation; uv.x is the natural 0..1 t for a horizontal gradient.
Common mistakes: mix(right, left, uv.x) (reversed); using uv (vec2) as t (type error with vec3); using gl_FragCoord.x as t (way over 1, so the result is just `right`).
Nudges: ask what t should be at the left edge and at the right edge, and which variable already does that.
