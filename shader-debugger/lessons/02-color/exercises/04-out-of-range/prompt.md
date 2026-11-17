## Out of range

A shader can compute values below 0 or above 1, but the screen **clamps** every color into 0..1 and doesn't warn you.

The starter makes stripes with `sin`, which swings between −1 and 1, and feeds that straight into `mix` to blend from `deep` to `warm`. But `mix` doesn't stop at its ends: when `t` goes below 0 it keeps going *past* `deep`, into colors the screen then clamps. Turn on **Inspect values** and put your cursor on the `col` line. The hatching shows where.

Fix it so every stripe fades smoothly from exactly `deep` to exactly `warm` and back. Keep the stripes. Change the *range* of `wave`, not its pattern. (You did the opposite in lesson 1, when you centered uv.)
