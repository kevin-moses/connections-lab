Key idea: reading a Hydra chain as GLSL: color functions wrap outward in written order; coordinate transforms nest inward in reverse order, so the last one written touches st first.
Common mistakes: rotate(kaleid(...)) (rotating the folded coordinates: the kaleidoscope doesn't turn, its stripes slide); color applied to st; forgetting the color call (the green test fails); using rotate's speed as its angle.
Nudges: have them list the chain's coordinate transforms backwards; ask which of rotate and kaleid sees the plain st.
