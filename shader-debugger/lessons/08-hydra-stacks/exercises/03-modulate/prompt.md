## Modulate: color moves coordinates

`modulate` takes a second chain's **color** and uses it to shift the **coordinates** of the first one. Red shifts `st.x` and green shifts `st.y`.

Write `modulate(st, c, amount)` like Hydra's: `st + c.rg * amount`. It's a coordinate transform, so it goes inside the source.

Then build Hydra's `osc(20, 0, 0).modulate(osc(4, 0, 0).rotate(1.5708), 0.15)`: soft horizontal stripes (the inner `osc(4)`, turned a quarter) bend the fine vertical stripes into waves. Evaluate the second chain at the plain `st`.
