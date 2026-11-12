Key idea: GL's origin is bottom-left; p5's is top-left. Flipping is `1.0 - uv.y`.
Common mistakes: `uv.y = -uv.y` (goes negative, shows black everywhere: use the inspector's hatching to show this); flipping x instead of y; flipping the whole uv.
Nudges: ask what uv.y is on the top row and what they want it to be there. 1 → 0 and 0 → 1 suggests 1 - y.
