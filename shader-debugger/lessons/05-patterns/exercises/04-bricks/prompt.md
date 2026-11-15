## Bricks

The starter tiles the canvas into bricks, 4 across and 8 up (`st = uv * vec2(4.0, 8.0)`), with thin light mortar lines. But every row lines up, which no real wall does.

**Shift every other row** sideways by half a brick, so the vertical joints alternate like a brick wall. The bottom row stays where it is; the row above it moves.

(Which row am I in? `floor(st.y)`. Is it odd? `mod(…, 2.0)`.)
