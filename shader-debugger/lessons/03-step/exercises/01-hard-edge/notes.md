Key idea: step(edge, x) is a threshold; the edge can be any value, including one from a uniform.
Common mistakes: step(uv.x, edge) (arguments swapped: the sides flip); using u_mouse.x without dividing (edge is in pixels while uv.x is 0..1: everything is black); dividing by u_resolution.y.
Nudges: ask which units uv.x and u_mouse.x are in; have them inspect `s` and move the mouse.
