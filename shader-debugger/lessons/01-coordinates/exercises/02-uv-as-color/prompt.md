## uv as color

`gl_FragCoord.xy / u_resolution` divides both components at once and gives **uv**, which runs 0 to 1 across and up the canvas. The starter shows it as color: red = x, green = y.

Look at where the black corner is. In p5, `(0, 0)` is the **top-left** and y grows downward. In shaders it's the **bottom-left** and y grows upward.

Flip `uv.y` so it works like p5: black in the top-left corner and green in the bottom-left.
