Key idea: a Hydra source is a function from position to color; osc is three phase-shifted sine waves of st.x, remapped from -1..1 to 0..1 (the lesson 2 remap), drifting with time * sync.
Common mistakes: shifting by offset instead of offset / frequency (the offset test fails); sin(x) * frequency (amplitude instead of frequency); forgetting the 0.5 + 0.5 * remap (half the wave clamps to black); using st.y; adding time outside the sin.
Nudges: ask what green should be at x = 0 and why; have them step into the failing test and compare r, g and b.
