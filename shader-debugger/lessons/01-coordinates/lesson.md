# Coordinates & uv

In p5 you'd paint a gradient with a loop: `for (x…) for (y…) set(x, y, color)`. A fragment shader has **no loop**. Instead, `main()` runs once for *every pixel, all at the same time*, and each run only knows where it is: `gl_FragCoord.xy`, that pixel's position in pixels.

This lesson is about turning that position into something useful: a 0-to-1 coordinate called **uv**, with its origin where you want it and its proportions right.

**Two tools to lean on:** click any pixel to run the shader for just that pixel and step through it. Turn on **Inspect values** to see the variable under your cursor across the whole canvas.
