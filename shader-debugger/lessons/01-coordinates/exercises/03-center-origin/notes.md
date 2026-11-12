Key idea: remapping ranges (×2 then −1), and that negative color values are invisible (clamped to 0).
Common mistakes: `uv - 0.5` only (gives −0.5..0.5, image is dimmer); `(uv - 1.0) * 2.0` (wrong order); applying abs before remapping.
Nudges: have them inspect `uv` after the remap and look at which quadrants are hatched; ask what abs(-0.8) is.
