# Coordinates & uv

In p5 you'd paint a gradient with a loop: `for (x…) for (y…) set(x, y, color)`. A fragment shader has **no loop**. Instead, `main()` runs once for *every pixel, all at the same time*, and each run knows only its own position in pixels, `gl_FragCoord.xy`.

This lesson turns that position into **uv**, a coordinate that runs 0 to 1, moves its origin to the center, and fixes its aspect ratio.

The app has two tools for this. Click any pixel to run the shader for just that pixel and step through it. Turn on **Inspect values** to see the variable under your cursor across the whole canvas.
