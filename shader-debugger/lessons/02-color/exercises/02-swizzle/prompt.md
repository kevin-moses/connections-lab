## Swizzling

`uv.x` and `uv.y` are single numbers. You can also grab several components at once, in any order, repeats allowed:

```glsl
uv.yx    // (y, x)
uv.xxy   // (x, x, y), a vec3
col.bgr  // blue and red swapped
```

Using **only uv and a swizzle** (no new math), match the target: red grows **upward**, while green and blue both grow **to the right**.
