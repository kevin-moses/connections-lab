# Color

A color in a shader is a `vec3` (red, green, blue) or a `vec4` (plus alpha), and every channel runs **0.0 to 1.0**, not 0 to 255 like p5's `fill()`.

Vectors come with shortcuts. `.rgb` and `.xyz` name the same components, and you can **swizzle**: reorder or repeat them (`col.bgr`, `uv.xxy`). `mix()` blends between colors like p5's `lerpColor()`.

The GPU **clamps** every color into 0..1 before it reaches the screen, without warning you. Negative values show as black and values over 1 as full brightness. Inspect mode hatches those values so you can see them.
