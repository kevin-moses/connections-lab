## Center the origin

Most shapes are easier to describe with `(0, 0)` in the **middle** of the canvas. Remap uv from 0..1 to −1..1:

```glsl
uv = uv * 2.0 - 1.0;
```

Try that first and look at the canvas. Then turn on **Inspect values** and put your cursor on that line. It hatches every value below zero. The screen can't show negative colors, so they come out black.

To finish, output **`abs(uv)`** as the color. The center should be black and get brighter toward every edge.
