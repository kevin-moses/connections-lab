## Out of range

Shaders happily compute colors brighter than 1.0 or darker than 0.0. The screen just **clamps** them, so the information is lost without any warning.

The starter maps `uv.x` to −1..1 and shows it as gray. Half the canvas is flat black. Turn on **Inspect values** and put your cursor on the `float v` line: the left half is hatched because it's below zero.

Remap `v` back into 0..1 so the whole canvas becomes one smooth black-to-white ramp. (Hint: it's the reverse of `* 2.0 - 1.0`.)
