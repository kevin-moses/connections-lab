Key idea: floor(uv * n) gives a cell's integer coordinates; parity of column + row gives a checkerboard.
Common mistakes: multiplying column and row parities (only odd-odd squares light up); mod(column, 2.0) * mod(row, 2.0); using fract instead of floor; 1.0 - the answer (the corner ends up white).
Nudges: ask for the column and row of a few squares and whether each is black or white; have them inspect column + row.
