Key idea: Hydra compiles coordinate transforms in reverse call order: the last .transform() in the chain is applied to st first, so it ends up innermost in the GLSL nesting.
Common mistakes: keeping the written order (rotate then repeat: the whole image tilts and tiles along the tilt); moving repeat outside osc (passing a color to a vec2 function: compile error); rotating with a different angle to compensate.
Nudges: ask which coordinates rotate should see (whole-canvas or tile) to tilt each tile; have them click the middle of two tiles and compare the stepper's st values inside rotate.
