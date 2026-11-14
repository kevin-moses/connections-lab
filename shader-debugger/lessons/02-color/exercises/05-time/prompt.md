## Animate with time

`u_time` counts seconds since the shader started. It's the shader version of p5's `millis() / 1000`.

Like `u_resolution`, it's a **uniform**: a value the app hands to every pixel. The app always sends it, but a shader only sees the uniforms it declares, and the starter doesn't declare this one yet. Add it under `u_resolution`:

```glsl
uniform float u_time;  // seconds since start
```

Then make the stripes from the last exercise **slide to the right** by a tenth of the canvas width every second. At `u_time = 2`, the picture should be the starter's picture moved right by 0.2. The checker looks at several moments in time.
