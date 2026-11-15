## Modulate: color moves coordinates

`modulate` is Hydra's most distinctive trick. It takes a second chain's **color** and uses it to push the **coordinates** of the first one: red pushes `st.x`, green pushes `st.y`.

Write `modulate(st, c, amount)` like Hydra's: `st + c.rg * amount`. It's a coordinate transform, so it goes inside the source.

Then build Hydra's `osc(20, 0, 0).modulate(osc(4, 0, 0).rotate(1.5708), 0.15)`: soft horizontal stripes (the inner `osc(4)`, turned a quarter) bend the fine vertical stripes into waves. The second chain is evaluated at the plain `st`.
