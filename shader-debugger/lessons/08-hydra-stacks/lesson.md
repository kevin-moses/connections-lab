# Stacking like Hydra

A Hydra sketch is one long chain, and the shader Hydra writes for it is just those functions **nested**. Once you know the rule for each kind, you can read any Hydra line as GLSL, and write the GLSL yourself:

- **Color functions** (`invert`, `brightness`, `color`, …) wrap the result *in the order you wrote them*.
- **Coordinate transforms** (`rotate`, `repeat`, `kaleid`, …) change `st` *before* the source reads it, and they run **last-written first**: `osc().rotate().repeat()` is `osc(rotate(repeat(st)))`.
- **Combining** (`add`, `diff`, `blend`, …) takes a second chain's color.
- **Modulating** (`modulate`, …) uses a second chain's color to push the **coordinates** around.

The functions you wrote in lesson 7 are already in each starter.
