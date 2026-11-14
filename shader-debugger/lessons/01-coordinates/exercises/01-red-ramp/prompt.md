## A red ramp

The starter colors every pixel by how far right it is:

```glsl
float red = gl_FragCoord.x / 400.0;
```

That only works because this canvas happens to be 400 pixels wide. Make it work for **any** canvas size by dividing by the real canvas width instead.

The app hands every pixel the canvas size as a **uniform**: a value that's the same for all pixels. A shader only sees the uniforms it declares, so first add this line above `out vec4 fragColor;`:

```glsl
uniform vec2 u_resolution;  // canvas size in pixels
```

Then replace `400.0` with `u_resolution.x`. The left edge should be black and the right edge full red, whatever the size. The checker tries a few different canvas sizes.
