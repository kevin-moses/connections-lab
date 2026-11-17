# Color

A color in a shader is a `vec3` (red, green, blue) or a `vec4` (plus alpha), and every channel runs **0.0 to 1.0**, not 0 to 255 like p5's `fill()`.

`.rgb` and `.xyz` name the same vector components, and you can **swizzle** them, which means reordering or repeating them (`col.bgr`, `uv.xxy`). `mix()` blends between colors like p5's `lerpColor()`.

The GPU **clamps** every color into 0..1 before it reaches the screen, without warning you. Negative values show as black and values over 1 as full brightness. **Inspect values** hatches those values so you can see them.
