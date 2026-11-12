Key idea: gl_FragCoord is in pixels; dividing by u_resolution normalizes it to 0..1 so the shader is resolution-independent.
Common mistakes: dividing by u_resolution (a vec2) and assigning to a float; using u_resolution.y; forgetting the .x.
Nudges: ask what the red value is at the right edge on a 64-pixel-wide canvas with the starter code. Point them at the u_resolution uniform declared at the top.
