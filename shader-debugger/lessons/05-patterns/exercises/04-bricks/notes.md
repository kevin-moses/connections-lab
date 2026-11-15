Key idea: offset the coordinate before tiling, by an amount that depends on the row (floor of y), to get staggered patterns; the same trick makes hex grids and staggered dots.
Common mistakes: shifting after fract (the shift wraps inside the brick and the joints don't move, or the mortar breaks); shifting every row (the whole wall slides, nothing alternates); using floor(uv.y) (always 0); shifting y instead of x.
Nudges: ask which row a pixel is in and whether that row should move; have them inspect st.x before and after the shift on two neighbouring rows.
