## Animate with time

`u_time` counts seconds since the shader started, and it's the shader version of p5's `millis() / 1000`. `sin(u_time)` swings smoothly between −1 and 1, once every 2π ≈ 6.3 seconds.

The starter uses it directly as red, so the pulse spends half its time below zero, stuck at black.

Remap the pulse so red swings smoothly between **0 and 1** instead. The checker looks at several moments in time.
