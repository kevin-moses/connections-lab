Key idea: fract(uv * n) maps every tile onto 0..1, so anything drawn in 0..1 coordinates repeats n x n times.
Common mistakes: fract(uv) * 4.0 (no repetition, just a bigger single circle); dividing instead of multiplying (zooms in); changing the radius to 0.3 / 4 (only right in uv units, not tile units); repeating only x.
Nudges: ask what uv * 4.0 runs from and to, and what fract does to 2.4; have them inspect the tile coordinate.
