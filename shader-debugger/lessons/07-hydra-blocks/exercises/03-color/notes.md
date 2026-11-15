Key idea: color functions are vec4 -> vec4 and wrap the source's result in call order, so a chain reads inside-out in GLSL: the first color function written is the innermost call.
Common mistakes: nesting in the wrong order (brightness(invert(...)): the image differs, darker stripes become lighter); changing alpha; clamping in brightness (the 1.1 test fails); invert as 1.0 - c * amount.
Nudges: ask what value comes out of each step for a 0.5 input; have them click a pixel and step into each call to watch the color change.
