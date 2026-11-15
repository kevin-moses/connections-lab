Key idea: animate a rotation by feeding time into the angle; to turn the shape counter-clockwise, rotate the lookup coordinates by the negative angle (inverse transform), like subtracting to move a pattern right.
Common mistakes: rotate2d(u_time) (spins clockwise: the 0.5 s test fails); forgetting to declare u_time; u_time * 6.28 (one turn per second, far too fast); rotating uv instead of the centered p (spins around the corner).
Nudges: point back to the sliding stripes in lesson 2; ask which way the bar should be pointing at 0.5 s and have them inspect q there.
