## Fix the aspect ratio

This canvas is twice as wide as it is tall, but uv still runs −1..1 in both directions. So one unit across covers twice as many pixels as one unit up.

`length(uv)` is the distance from the center, and `1.0 - d` should make a **round** glow. Instead it comes out as an oval.

Fix it by stretching x by the aspect ratio, *after* centering:

```glsl
uv.x *= u_resolution.x / u_resolution.y;
```

The checker tries wide, square and tall canvases. The glow should be round on all of them.
