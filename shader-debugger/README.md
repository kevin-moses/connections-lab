# Shader Debugger

Learn GLSL by seeing what every line does. See [PROPOSAL.md](PROPOSAL.md) for the full design.

## Run

```bash
npm install
cp .env.example .env   # then add OPENROUTER_API_KEY for the tutor
npm run dev        # Vite on :5173 + tutor proxy on :3001 (proxied at /api)
npm test           # unit tests
npm run test:e2e   # browser tests in your installed Chrome
npm run typecheck
npm run build && npm start   # production: one server for the app and the tutor (PORT, default 3001)
```

## Status: M0 (skeleton) ✅

- CodeMirror 6 editor with GLSL ES 3.00 highlighting, autosaved to localStorage.
- WebGL2 runner: full-screen triangle, `u_resolution` / `u_time` / `u_mouse` (pixels, bottom-left origin), pause/reset time, live recompile (200 ms debounce). A broken compile keeps the last good shader on screen.
- GPU errors parsed from the info log, mapped through a `LineMap` back to your lines (the injected `#version 300 es` never shifts line numbers), with the offending token underlined.
- Debugger parser runs on every edit; the `AST` pill flags shaders the GPU accepts but the parser doesn't (a parser gap to fix, not your mistake).
- Express tutor proxy, with a stub model until M4.

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

## Status: M3 (lessons) ✅

The app opens in **Lessons** mode (switch to **Sandbox** in the top bar for free play; each mode keeps its own code).

- **Lessons 1–3, 14 exercises** (lessons 4–6 below): coordinates & uv (red ramp, uv as color with p5's flipped y, centering, aspect ratio), color (p5 colors, swizzles, `mix`, out-of-range values, `u_time`), and step & thresholds (hard edges, bands, rectangles, a `rect()` function, `smoothstep`).
- Each exercise has a prompt written for p5 users, a **predict-then-reveal** question (answer it, then the stepper opens on that exact pixel), a live **target preview**, and a **live checklist** that re-runs as you type.
- Checks: an **image diff** against the hidden reference under several setups (canvas sizes, times, mouse positions), with yours / target / red-difference thumbnails when it fails; **pixel**, **region** and **increasing** probes; and **function tests** that call your GLSL function on the CPU, each with **Step into this call**.
- Lesson canvases have an exact pixel size (e.g. 400×400, 600×300), so "the pixel at x = 100" means what it says.
- Progress (code, passed, predictions) is saved in localStorage.

Lesson files live in `lessons/<NN-lesson>/exercises/<NN-exercise>/` (`exercise.json`, `prompt.md`, `starter.glsl`, `reference.glsl`, `notes.md` for the M4 tutor). Teacher notes are read only by the tutor server and are never bundled into the browser. Reference solutions are bundled (the checker renders them in the browser), so they are hidden only from the UI; before a public deploy, checking has to move off the client. `test/lessons.test.ts` renders every exercise on the CPU interpreter and asserts: the reference passes every check, the starter fails at least one, and each prediction's explanation matches what the code really does. Add a lesson by adding a folder; the tests cover it automatically.

## Status: M4 (tutor) ✅ (needs an API key)

The tutor explains, hints and decodes errors. It never writes your exercise code. Add `OPENROUTER_API_KEY` to `.env` and restart `npm run dev`; until then, tutor requests say how to connect. (`curl localhost:5173/api/health` shows whether it's live.)

- **Explain** on each compile error in Problems: what the GPU's terse message means and where to look.
- **Hover docs and completion** for every GLSL built-in and the app's inputs (`u_time`, `fragColor`, …), from `shared/glslReference.ts`. The tutor gets the same entries for the built-ins in your code, so its explanations match the docs. Examples are tested not to match any exercise's solution.
- **I'm stuck** (lesson pane): a three-step hint ladder: *Nudge* (one thing to look at), *Concept* (the idea or built-in), *Steps* (plain-English steps, no code). Hints are saved with your progress. Each hint sees your code, the checklist, compile errors, and the stepper's current values if you're debugging a pixel.

How it stays a teacher, not a coder:

- The server reads the exercise prompt and **teacher notes** (`notes.md`) from disk. It never opens `reference.glsl`; a test checks that no solution line reaches any prompt.
- In exercises, every answer is screened (`server/tutor/filter.ts`): code blocks, statements, and expressions built from your variables (`bandX * bandY`) are refused, while names, built-ins on placeholders (`step(edge, x)`) and quotes of your own code are fine. A refused answer is retried once with a stricter instruction, then replaced by a canned nudge toward the Debugger. The sandbox allows tiny snippets.

Model (override in `.env`): the free `nvidia/nemotron-3-ultra-550b-a55b:free` on [OpenRouter](https://openrouter.ai), at medium reasoning effort for hints and errors (a `fast` tier is configured but unused since Explain lines was removed). Free models are rate-limited by OpenRouter (per minute and per day), and their providers may log prompts, which include the learner's code. `TUTOR_PROVIDER=stub` turns model calls off. The browser only talks to `/api/tutor`; `LanguageModel` (`server/tutor/provider.ts`) is the swappable piece.

The proxy listens on 127.0.0.1 only and limits each client to `TUTOR_RATE_LIMIT` requests a minute (default 60). Not yet: a bring-your-own-key field (needed before deploying anywhere public).

## Status: M5 (dialects) ✅: p5, Shadertoy, three.js

**Paste a Shadertoy shader and debug it as is.** Code that defines `mainImage(out vec4 fragColor, in vec2 fragCoord)` and no `main` is wrapped the way shadertoy.com does it: its inputs declared in front, a `main` that calls `mainImage`. Canvas, Inspect values, the Debugger (it starts at `mainImage` with that pixel's `fragCoord`) and its GPU cross-check all work on it. Inputs come from the app's own: `iResolution = (u_resolution, 1)`, `iTime = u_time`, `iMouse = (u_mouse, 0, 0)`. `iFrame`, `iTimeDelta` and `iFrameRate` assume 60 fps, `iDate.w` is the time, and `iChannel0..3` read black (textures are a later stage). As on Shadertoy, the image is opaque.

**Language dropdown** (GLSL ES 3.00, p5, Shadertoy) in the editor header. Switching rewrites the code with the parser. Comments and formatting are kept, and when something can't be converted it says why. Lessons stay written in ES 3.00; starters and saved code are shown in the chosen style.

- **p5 style** is GLSL ES 1.00 as in p5's docs: the built-in `gl_FragColor`, `varying vec2 vTexCoord`, `texture2D`. The GPU path converts it the way three.js does (`#define`s plus one output declaration, lines mapped back), so errors land where you wrote them.
- **Shadertoy style**: `main` ↔ `mainImage(out vec4 fragColor, in vec2 fragCoord)`, `gl_FragCoord.xy` ↔ `fragCoord`, `u_resolution` / `u_time` / `u_mouse` ↔ `iResolution.xy` / `iTime` / `iMouse.xy`. Other Shadertoy inputs keep their names and become declared uniforms in ES 3.00, which the app supplies.
- The style is read from the code itself (Shadertoy defines `mainImage`, ES 3.00 declares an `out`, ES 1.00 writes `gl_FragColor`), so every tool works on any of the three whatever the dropdown says.
- **three.js code runs as pasted**: a `ShaderMaterial` fragment shader is ES 1.00 or 3.00 code without a `precision` line (three adds one), so the app adds it too.
- **Varyings**: `vTexCoord` matches p5's full-canvas plane (0..1, origin top-left, y down, measured in real p5 2.4.0), and `vUv` matches three.js's `PlaneGeometry` (origin bottom-left). Both are supplied in every style.

**Export** (p5.js, three.js or Shadertoy). Uniforms keep the app's names everywhere (`u_resolution`, `u_time`, `u_mouse`, in the same units), and the p5 and three.js harnesses also set any Shadertoy inputs the code uses.
- **p5.js**: a p5 2.x sketch (also runs on 1.x). Copy `sketch.js` for editor.p5js.org, or download a page that runs on its own.
- **three.js**: a page that loads three r187 through an import map and draws a `PlaneGeometry(2, 2)` with a `ShaderMaterial`. ES 1.00 code runs as written, ES 3.00 with `glslVersion: THREE.GLSL3`. Download it, or copy `main.js`.
- **Shadertoy**: the code in Shadertoy style, ready for the Image tab.

Tested end to end: every lesson's reference passes its checks in p5 and in Shadertoy style, and conversions are stable both ways. The self-test runs each corpus shader in all three styles. Exports run in real p5 2.4.0 and real three.js r187 (from `node_modules`, no network) and match the app's pixels, in every style, including three.js-style code with `vUv` and no `precision`.

Limits:
- p5-style code may use ES 3.00-only features (bit operations, `uint`, `switch`) that the app accepts but real p5 (ES 1.00) won't compile.
- Shadertoy multipass (Buffer A–D), textures, sound and cubemap passes aren't supported.
- three.js: `RawShaderMaterial`, `#include` chunks and `onBeforeCompile` aren't converted; the fragment-only built-ins three declares (`cameraPosition`, `viewMatrix`, `isOrthographic`) aren't supplied.
- p5 2.4.0 itself requests a translations file from the CDN that does not exist, so any sketch loading p5 from a CDN shows a harmless 404 in the console.

The facts these choices rest on (p5 2.4.0 and three.js r187 behaviour) are in [docs/decisions/0001](docs/decisions/0001-dialects-keep-display-positions.md).

## Status: Stage 2 (vertex + mesh), first slice ✅

In the sandbox, switch **2D canvas / 3D mesh** in the top bar. Mesh mode draws a vertex shader and a fragment shader on a built-in **plane, sphere or box**:
- **Two files**, `vertex.glsl` and `fragment.glsl`, as editor tabs. Each keeps its own undo history, and errors are shown per file ("vertex.glsl Ln 12" in Problems).
- **p5's names**: `aPosition`, `aNormal`, `aTexCoord` in; `uModelViewMatrix`, `uProjectionMatrix`, `uNormalMatrix` from the camera; plus `u_time`, `u_resolution`, `u_mouse`. ES 1.00 code (`attribute`, `varying`) runs too, converted like three.js does.
- The meshes are unit-sized like p5's (−0.5..0.5), and the plane's texture coordinates follow p5: (0, 0) at the top-left.
- **Drag to orbit**, scroll to zoom.
- **Click a vertex to step through the vertex shader for it**, with inline values, the variables panel (attributes, uniforms, `gl_Position` and the varyings), step over/out, and Shift-click to compare two vertices. The **GPU cross-check** reads every vertex's real `gl_Position` back with transform feedback and compares. Picking uses those positions too, so you can click a displaced vertex where it actually is.

Not yet in mesh mode: Inspect values, stepping a fragment on the mesh (that's Stage 3, the rasterizer bridge), the language dropdown, export, and lessons. Those are the next slices.

## Lessons 4–6 ✅

Twelve more exercises, built like lessons 1–3 (each with a prediction, a live checklist and teacher notes for the tutor):
- **4. Shapes with distance**: a ring with `abs(d − r)`; two discs merged by taking the smaller distance; a square from `max(abs(p.x), abs(p.y))`; inside, outside and an outline from one signed distance.
- **5. Patterns and tiling**: repeat with `fract`; a checkerboard from `floor` and `mod`; a different circle per tile; bricks offset every other row.
- **6. Rotation and polar coordinates**: write `rotate2d()` (GLSL's `mat2` is column-major; function tests check it); spin a bar with `u_time` (and the inverse-rotation surprise); twelve slices with `atan`; a five-petal flower from `r(a)`.

Each one is tested like the rest: the reference passes and the starter fails every check, each prediction matches its explanation, each converts to p5 and Shadertoy style and still passes, and no teacher note quotes the solution.

## Lessons 7–8: Hydra ✅

How [Hydra](https://hydra.ojack.xyz)'s functions are built from GLSL, and how its chains become nested calls:
- **7. Hydra's building blocks**: write `osc` (three phase-shifted sines), `rotate` (a coordinate transform, so it goes *inside* the source), `brightness` and `invert` (color functions, so they wrap *outside*, in the order written), and `kaleid` (folding the angle).
- **8. Stacking like Hydra**: coordinate transforms run last-written first (`osc().rotate().repeat()` is `osc(rotate(repeat(st)))`); `diff` combines two chains' colors; `modulate` uses one chain's color to move another's coordinates; then translate a whole sketch, `osc(30, 0.1, 1.2).kaleid(5).rotate(0, 0.3).color(1.0, 0.6, 0.9)`, into one nested expression.

The GLSL is our own, written to match the behaviour documented in hydra-synth's source (parameter names, defaults, Hydra's `st` and `time`), not copied from it: hydra-synth is AGPL-3.0. The lessons credit Hydra and Olivia Jack. Function tests check each piece. A test also confirms that likely mistakes fail: the wrong transform order, colors in the wrong order, `kaleid` without the mirror, and modulating the color instead of the coordinates.

## Deploy (Railway)

In production, one Express server serves the built app (`dist/`) and the tutor API. `npm run build` builds the app (just Vite; run `npm run typecheck` and the tests before pushing). `npm start` runs the server with `NODE_ENV=production`, which means it:
- listens on `0.0.0.0:$PORT`;
- trusts one proxy hop, so per-client limits see real addresses;
- caches hashed assets for a year and always revalidates `index.html`;
- sends `nosniff`, `Referrer-Policy` and `X-Frame-Options` headers.

Railway's default builder (Railpack) finds both scripts in `package.json`, so there's no config file. Railway no longer reads `railway.json` for new services. Set up the service once:

1. **New Project → Deploy from GitHub repo →** `connections-lab`.
2. In the service's **Settings**:
   - **Root Directory** `shader-debugger`;
   - **Healthcheck Path** `/api/health`;
   - optionally a domain under **Networking → Generate Domain**.
3. **Variables**:
   - `OPENROUTER_API_KEY` (your key);
   - optionally `TUTOR_DAILY_LIMIT` (default 300 requests a day for everyone together) and `TUTOR_RATE_LIMIT` (default 20 a minute per visitor).

   Without a key the app still works, and the tutor says it isn't connected.
4. Push to the branch Railway watches. Every push redeploys.

`engines.node` pins Node 24 (LTS). The daily cap is counted in memory, so a restart resets it.

What's public on purpose: the lesson reference solutions are in the browser bundle, because the checker renders them there. They're hidden in the UI but readable in devtools. The teacher notes stay on the server.

## Layout

```
shared/                  browser ↔ proxy contract (tutor.ts), GLSL reference, plus code both sides use (LRU, lesson files)
server/                  Express proxy (loopback only) + request validation + rate limit
server/tutor/            Tutor (cache, screen, retry), prompts, filter, material (lesson files), Claude model, stub
src/tutor/               client (fetch + safe markdown), error explainer
src/glsl/                linemap, prepare (ES 1.00 → 3.00 conversion, version injection), diagnostics (info-log parsing), parse (AST)
src/dialects/            style conversion (convert: p5, Shadertoy, shared edits), export (p5 sketch, three.js page, Shadertoy)
src/glsl/shadertoy.ts    Shadertoy's inputs: one table for the GPU header, uniform values and the interpreter
src/mesh/                3D: geometry (plane, sphere, box), mat4, orbit camera, scene (draw, transform-feedback readback, picking), meshMode (tabs, vertex stepping)
src/render/              runner (WebGL2 loop, pluggable overlay), fullscreen pass (shared GPU plumbing), gl helpers, render types
src/probe/               value-as-image: target, rewrite, probeLayer, visualize, inspector (UI)
src/interp/              CPU interpreter: values, ops, builtins, interpreter, trace (types), astUtil, corpus
src/debugger/            stepper UI: navigation (step over/out, alignment), crossCheck (GPU vs CPU), debugger (panel + editor)
src/lessons/             types, loader/content, checker, cpuRender, predict, progress, lessonView (pane)
src/render/offscreen.ts  small GPU renderer for checks and the target preview
lessons/                 lesson content (markdown, JSON, GLSL)
selftest.html            GPU vs interpreter agreement report
src/editor/              CodeMirror setup + GLSL language + reference (completion, hover docs)
src/events.ts            typed Emitter used for frame and compile events
docs/decisions/          design decisions (0001: how M5 dialects keep positions)
test/                    vitest (unit)
e2e/                     Playwright smoke tests against real Chrome (npm run test:e2e)
```

## Parser spike result

`@shaderfrog/glsl-parser` 7.x is adopted. On ES 3.00, ES 1.00 (p5-style) and Shadertoy sources it:

- round-trips byte-for-byte (`generate(parse(src)) === src`), so the probe rewriter (M1) and dialect adapters (M5) can edit the AST and print it back without disturbing your formatting;
- attaches line/column locations to every statement and identifier;
- builds scopes (global / per function / per loop) with bindings and function tables;
- reports syntax errors with a location;
- parses the example shader in single-digit milliseconds after warm-up.

Gotcha: it warns about undeclared identifiers like `gl_FragColor` or `iTime`; we pass `quiet: true`. These properties are pinned in `test/parser.test.ts`.
