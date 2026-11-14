## Out of range

Shaders happily compute values below 0 or above 1. The screen **clamps** every color into 0..1, so whatever was outside is lost without any warning.

The starter makes stripes with `sin`, which swings between −1 and 1, and feeds that straight into `mix` to blend from `deep` to `warm`. But `mix` doesn't stop at its ends: when `t` goes below 0 it keeps going *past* `deep`, into colors the screen then clamps. Turn on **Inspect values** and put your cursor on the `col` line: the hatching shows where.

Fix it so every stripe fades smoothly from exactly `deep` to exactly `warm` and back. Keep the stripes: change the *range* of `wave`, not its pattern. (You did the opposite in lesson 1, when you centered uv.)
