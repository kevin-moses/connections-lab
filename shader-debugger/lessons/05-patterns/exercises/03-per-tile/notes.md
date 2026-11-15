Key idea: floor(uv * n) is a per-tile id; any value computed from it (size, color, rotation) varies tile by tile while fract keeps the shape the same.
Common mistakes: using tile.x instead of id.x (the radius changes inside each tile, giving egg shapes); 0.1 * id.x without the + 0.1 (first column empty); dividing id.x by 4 (wrong scale); using id.y (grows bottom to top).
Nudges: ask what id.x is in each column and what radius each column wants; have them inspect id.x and then r.
