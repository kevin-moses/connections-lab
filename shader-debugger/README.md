# Shader Debugger

Learn GLSL by seeing what every line does. See [PROPOSAL.md](PROPOSAL.md) for the full design.

## Run

```bash
npm install
npm run dev        # Vite on :5173 + tutor proxy on :3001 (proxied at /api)
npm test           # unit tests
npm run typecheck
```

## Status: M0 (skeleton) ✅

- CodeMirror 6 editor with GLSL ES 3.00 highlighting, autosaved to localStorage.
- WebGL2 runner: full-screen triangle, `u_resolution` / `u_time` / `u_mouse` (pixels, bottom-left origin), pause/reset time, live recompile (200 ms debounce). A broken compile keeps the last good shader on screen.
- GPU errors parsed from the info log, mapped through a `LineMap` back to your lines (the injected `#version 300 es` never shifts line numbers), with the offending token underlined.
- Debugger parser runs on every edit; the `AST` pill flags shaders the GPU accepts but the parser doesn't (a parser gap to fix, not your mistake).
- Express tutor proxy behind a `TutorProvider` interface, with a stub provider until M4.

## Status: M1 (value-as-image) ✅

Turn on **Inspect values** and put the cursor on any statement inside a function. The canvas shows that value, captured *after* the statement runs, for every pixel at once.

- Cursor on a variable name → that variable (`uv`); on a swizzle → just that part (`uv.x`); elsewhere on the line → the variable the line declares/assigns. On a `return` line → the returned value (works inside your own functions).
- **Raw** (default): clamped like the GPU; `/` cyan hatching = below 0, `\` dark hatching = above 1. **Diverging**: blue < 0 < red with a zero contour (SDFs). **Auto**: min..max stretched to black..white.
- Component picker (`x y z w`), and a **loop pass** picker when the line runs more than once per pixel.
- Hover for the exact value at a pixel. While inspecting, `u_mouse` only moves on click-drag, so hovering doesn't change what you're reading.
- Pixels that never reach the line show a dim checkerboard.

How it works: `src/probe/target.ts` picks the statement + expression from the AST; `rewrite.ts` edits the source (rename `main`, inject a one-line helper preamble, add a capture call, without moving any line numbers) into a shader that writes the value and metadata to two float render targets; `probeLayer.ts` renders those and reads back pixels; `visualize.ts` is the display shader.

Known limits (M2's CPU stepper covers these): values on pixels that later `discard` are lost (shown as not reached); arrays, structs and matrices can't be shown yet; probing a global/uniform needs a statement that uses it.

## Status: M2 (single-pixel stepper) ✅

**Click any pixel** on the canvas. The shader runs on the CPU for just that pixel (with time and mouse frozen at the click), and the **Debugger** tab lets you walk through every step.

- Timeline slider plus ⏮ ⤺ ◀ ▶ ⤼ ⤴ ⏭: step back/forward, step *over* or *out of* function calls, and **⇥ cursor** runs to the line your editor cursor is on. With the panel focused: ←/→, Shift+←/→ (over), Home/End, Esc.
- The current line is highlighted; every line that has run shows its latest value at the line end (with the loop pass).
- Variables table (locals, outputs, inputs/uniforms) highlights what just changed; vec3/vec4 get a color chip. Built-in calls show inputs → output (`length((0.07, -0.08)) → 0.10`). Call stack shows where you are.
- **Shift-click a second pixel** to compare: B's values appear next to A's everywhere, and lines where the two pixels ran differently (a different branch, more loop passes) get a pink tint.
- **GPU cross-check**: the same pixel is rendered on the GPU and compared with the stepper's result. The pill says `GPU ✓ agrees` or warns when they differ.
- Edits re-run the trace automatically; **Re-run now** re-freezes time and mouse.

Interpreter (`src/interp/`): GLSL ES 3.00 values with float32 rounding, all operators incl. matrix math, control flow (if/for/while/do/break/continue/return/discard), user functions with `in`/`out`/`inout` and overloads, arrays, swizzle/index assignment, `#define` constants, and 64 built-ins. Caps: 20,000 steps and 1,000 passes per loop, reported rather than hanging.

**Self-test:** open `/selftest.html` to run 10 sample shaders through both the CPU interpreter and the GPU on a grid of pixels. Currently 480/480 pixels agree (max difference 1.3e-4).

Not yet in the stepper: textures (`texture()`), derivatives (`dFdx`/`fwidth`), structs, `switch`, function-like macros. It tells you plainly when it hits one.

## Layout

```
shared/tutor.ts          browser ↔ proxy contract
server/                  Express proxy, TutorProvider + stub
src/glsl/                linemap, prepare (version injection), diagnostics (info-log parsing), parse (AST)
src/render/              runner (WebGL2 loop) + gl helpers
src/probe/               value-as-image: target, rewrite, probeLayer, visualize, inspector (UI)
src/interp/              CPU interpreter: values, ops, builtins, interpreter (trace), crossCheck, corpus
src/debugger/            stepper UI: navigation (step over/out, alignment), debugger (panel + editor)
selftest.html            GPU vs interpreter agreement report
src/editor/              CodeMirror setup + GLSL language
test/                    vitest
```

## Parser spike result

`@shaderfrog/glsl-parser` 7.x is adopted. On ES 3.00, ES 1.00 (p5-style) and Shadertoy sources it:

- round-trips byte-for-byte (`generate(parse(src)) === src`), so the probe rewriter (M1) and dialect adapters (M5) can edit the AST and print it back without disturbing your formatting;
- attaches line/column locations to every statement and identifier;
- builds scopes (global / per function / per loop) with bindings and function tables;
- reports syntax errors with a location;
- parses the example shader in single-digit milliseconds after warm-up.

Gotcha: it warns about undeclared identifiers like `gl_FragColor` or `iTime`; we pass `quiet: true`. These properties are pinned in `test/parser.test.ts`.
