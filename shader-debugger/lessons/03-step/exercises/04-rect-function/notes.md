Key idea: functions in GLSL; component-wise step on vec2; collapsing a vec2 mask with x * y.
Common mistakes: returning `inside` (a vec2) from a float function (compile error); `inside.x + inside.y` (OR instead of AND: the "above the box" test fails); swapping lo/hi.
Nudges: have them step into the failing test call and watch `inside`; ask what inside.x and inside.y are for a point above the box.
