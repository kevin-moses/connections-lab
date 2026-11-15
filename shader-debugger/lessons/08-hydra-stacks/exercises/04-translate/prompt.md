## Translate a Hydra sketch

Here's a whole Hydra sketch:

```js
osc(30, 0.1, 1.2).kaleid(5).rotate(0, 0.3).color(1.0, 0.6, 0.9)
```

Every function it uses is in the starter. Write `main` as **one nested expression**, using the rules:

- `color` is a color function: it wraps everything else.
- `kaleid` and `rotate` are coordinate transforms: they go inside `osc`, **last written first**.

The `rotate` has speed 0.3, so it turns slowly. The checker looks at a few moments.
