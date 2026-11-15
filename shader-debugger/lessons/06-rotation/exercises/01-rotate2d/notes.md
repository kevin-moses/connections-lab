Key idea: a 2D rotation is a mat2 whose columns are where the x and y axes go: (cos, sin) and (-sin, cos). GLSL's mat2 constructor fills columns first.
Common mistakes: writing the rows (mat2(c, -s, s, c)): rotates clockwise, so the quarter-turn test gets (0, -1); degrees instead of radians; swapping sin and cos; returning a vec2.
Nudges: ask where (1, 0) should end up after a quarter turn; have them step into the failing quarter-turn test and look at the matrix's columns in the variables panel.
