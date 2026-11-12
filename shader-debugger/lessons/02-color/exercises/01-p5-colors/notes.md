Key idea: shader colors are normalized 0..1; values above 1 clamp.
Common mistakes: writing `128 / 255` (integer division gives 0 and won't compile mixed with floats); none serious: 0.5 for green is close enough (0.5 vs 0.502 passes the 0.01 tolerance), so accept it.
Nudges: ask what 255 / 255 is, and what the screen does with 128.0.
