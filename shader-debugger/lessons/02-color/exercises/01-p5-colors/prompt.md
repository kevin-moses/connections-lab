## p5 colors in a shader

In p5 you'd write `fill(255, 128, 0)` for orange. In a shader every channel runs 0.0–1.0 instead.

Fill the whole canvas with that same orange. Divide each p5 number by 255: red is `1.0`, and green is `128.0 / 255.0`.
