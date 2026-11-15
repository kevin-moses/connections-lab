Key idea: a "distance" is any way of measuring; max(abs(x), abs(y)) (Chebyshev distance) has square level sets, so thresholding it draws a square. abs() mirrors all four quadrants onto one.
Common mistakes: forgetting abs (only the bottom-left quadrant works); abs(p.x) + abs(p.y) (a diamond); min instead of max (a cross/plus shape); using the rect() function from lesson 3 (hard edges, image differs).
Nudges: ask what shape the points with max(...) = 0.2 make; have them inspect d with the circle version and the square version.
