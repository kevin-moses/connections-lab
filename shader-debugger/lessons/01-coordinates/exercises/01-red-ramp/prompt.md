## A red ramp

The starter colors every pixel by how far right it is:

```glsl
float red = gl_FragCoord.x / 400.0;
```

That only works because this canvas happens to be 400 pixels wide. Make it work for **any** canvas size: replace `400.0` with the canvas width from the `u_resolution` uniform (`u_resolution.x`).

The left edge should be black and the right edge full red, whatever the size. The checker tries a few different canvas sizes.
