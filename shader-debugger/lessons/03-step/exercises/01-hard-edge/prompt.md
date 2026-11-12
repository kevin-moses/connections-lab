## A hard edge

`step(0.5, uv.x)` is 0 on the left half and 1 on the right. That's a whole `if/else` in one call.

Make the edge follow the **mouse**: everything to the right of the mouse should be white. `u_mouse` is in pixels, so turn its x into uv first, the same way you made uv.

(Move your mouse over the canvas to try it. The checker places the mouse in a couple of spots.)
