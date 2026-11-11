# Shader Debugger — Proposal

A web app for learning GLSL by **seeing what every line does**. You write shaders; the tool lets you step through any single pixel like a normal debugger, or see any intermediate value painted across the whole screen. An AI tutor explains, hints, and decodes errors — it never writes your exercise code.

Status: **proposal, awaiting sign-off.** No code yet.

---

## 1. Decisions (from the grilling session)

| Topic | Decision |
|---|---|
| Audience | You first (knows programming, new-ish to shaders). Designed for people coming from **p5.js**. Runs locally for now; deployable later. |
| Form | Web app. |
| Shader scope | Fragment-only (full-screen) in v1. Architecture is stage-agnostic so the **full pipeline** (vertex → raster → fragment, textures, multipass) follows. |
| Dialects | One internal **canonical** form; edit/view in **p5 (default), three.js, or Shadertoy** dialect; import + export with runnable harnesses. |
| Debugger | **Both**: value-as-image (GPU) and single-pixel stepper (CPU interpreter), linked. Trace-and-scrub timeline, inline values, changed-variable highlighting, compare-two-pixels mode. |
| Value display | **Raw by default with out-of-range hatching**; one-click diverging / auto-normalized; hover for exact values. |
| Checking | **Image diff** against a hidden reference + **unit tests** (pixel probes and GLSL function tests). No AI grading. |
| AI tutor | Claude via a server-side proxy behind a swappable `TutorProvider` interface. **Hint ladder**, never exercise code. Triggers: one-line explainer, "explain this error", "I'm stuck". No open chat in v1. |
| Tutor context | Sees your code, lesson goal, traced values, errors, hint level, reference entries, and hand-written **teacher notes** — **never the reference solution**. |
| Lessons | Hybrid: hand-authored skeleton + targets + tests + teacher notes; AI fills explanations. v1 ships lessons **1 Coordinates & uv, 2 Color, 3 step & thresholds**, each with predict-then-reveal moments. |
| Stack | Vite + TypeScript, no framework (add React only if UI state gets painful). Express for the LLM proxy. **CodeMirror 6** editor. Hand-curated GLSL reference JSON. |
| Persistence | localStorage (+ export/import JSON). No accounts, no DB. |
| Not now | Sandpack (revisit for "run in real p5/three" preview of exports), React, deployment, open chat, textures, vertex shaders. |

---

## 2. How it works

```
┌──────────────── Browser (Vite + TS) ─────────────────────────────────────┐
│                                                                          │
│  Lesson panel ── Editor (CM6) ─────────── Canvas (WebGL2)                │
│      │          inline values, gutter,     live render, pixel picker,    │
│      │          hover docs, completion     value-as-image overlay        │
│      │                │                          │                       │
│      │         ┌──────┴────── store (events) ────┴──────┐                │
│      │         │                                        │                │
│      │   Dialect layer ──► canonical GLSL + line map    │                │
│      │         │                                        │                │
│      │   Parser (AST) ─┬─► Probe rewriter ──► GPU       │                │
│      │                 └─► Interpreter ──► Trace ──► Stepper panel       │
│      │                                       (timeline, vars, stack)     │
│   Checker: image diff + probes + function tests (uses GPU + interpreter) │
│   Tutor client ─────────────────────────────────────────┐                │
└─────────────────────────────────────────────────────────┼────────────────┘
                                                          │ POST /api/tutor/*
                                    ┌─────────────────────▼─────────────┐
                                    │ Express proxy: TutorProvider →     │
                                    │ ClaudeProvider, prompts, output    │
                                    │ filter, cache. API key in .env     │
                                    └───────────────────────────────────┘
```

### 2.1 Canonical dialect & conversion

Everything runs internally as **GLSL ES 3.00** with Book-of-Shaders-style uniform names (which most p5 tutorials already use):

```glsl
precision highp float;
uniform vec2  u_resolution;   // pixels
uniform float u_time;         // seconds
uniform vec2  u_mouse;        // pixels, bottom-left origin
out vec4 fragColor;
void main() { ... }
```

Dialect adapters are **AST-based** (not regex) and keep a **line map**, so errors, inline values, and breakpoints land on the lines you actually see.

| Adapter | Display form | Conversion |
|---|---|---|
| p5 (default) | ES 1.00 style (`gl_FragColor`, `varying vec2 vTexCoord`) as in most p5 tutorials; ES 3.00 toggle | `gl_FragColor`↔`out`, `varying`↔`in`, `texture2D`↔`texture`; same uniform names |
| three.js | `ShaderMaterial` fragment with `vUv` varying, `uTime`/`uResolution` conventions | rename uniforms; account for three's injected prefix |
| Shadertoy | `mainImage(out vec4 fragColor, in vec2 fragCoord)`, `iTime`/`iResolution`/`iMouse` | wrap/unwrap `mainImage`, `gl_FragCoord`↔`fragCoord`, `iResolution.xy`↔`u_resolution` |

**Import**: paste from Shadertoy/p5/three → canonical. **Export**: shader + a minimal runnable harness (p5 `sketch.js` + `.vert`/`.frag`; three `main.js` with full-screen plane + `ShaderMaterial`; Shadertoy paste-ready). Conversion is deterministic tool code — the AI is not involved.

Won't convert (tool says so explicitly): Shadertoy multipass/feedback, p5 2.x shader hooks / p5.strands, three `#include` chunks / `onBeforeCompile`.

> Verify before building adapters: exact current p5 (1.x vs 2.x) default GLSL version and built-in names, and three's injected prefix for `ShaderMaterial` vs `RawShaderMaterial`.

### 2.2 Value-as-image (GPU)

Select a line or click a variable → the tool rewrites the AST to capture that value into a global `_probe` at that point and output `visualize(_probe)` at the end of `main`. Works inside user functions and loops (loop: captures last iteration by default; iteration selector).

- `float` → gray, `vec2` → RG, `vec3` → RGB, `vec4` → RGB over checkerboard alpha, `bool` → B/W.
- **Raw** (default): GPU clamping, plus diagonal hatching computed in-shader from `gl_FragCoord` wherever a component is < 0 or > 1 (different hatch direction for each).
- **Diverging**: blue < 0 < red, white at 0 (SDFs). **Auto**: min–max normalized (min/max from a low-res readback).
- Hover any pixel → exact value via `readPixels` on a float render target.

### 2.3 Single-pixel stepper (CPU interpreter)

A tree-walking interpreter over the same AST, **stage-agnostic**: it runs a function given a set of inputs (`gl_FragCoord` + uniforms today; vertex attributes later).

- **Values**: tagged float32 storage (`Math.fround`) for `float/int/bool`, `vec2–4`, `ivec`, `bvec`, `mat2–4`; swizzle read/write; constructors; full operator set incl. matrix×vector.
- **Control flow**: `if`, `for`, `while`, `do`, `break`, `continue`, `return`, `discard`, ternary; user functions with `in/out/inout`; `const`; fixed-size arrays. Structs in stage 2.
- **Built-ins**: ~60 for 2D work, implemented to the ES 3.00 spec, each with a unit test.
- **Trace**: every statement emits `{loc, changedVars, callDepth, loopIter}`. You scrub a timeline backward/forward; current values appear inline at line ends; the variables panel highlights what changed; call stack panel for user functions. Built-ins are one step showing inputs → output (with their one-liner).
- **Safety**: step cap (default 100k) + per-loop iteration cap (1000), reported as a teaching moment rather than a hang.
- **GPU cross-check**: after tracing a pixel, compare the interpreter's final color to the GPU's. Mismatch beyond tolerance → visible warning. This keeps the interpreter honest and finds its bugs.
- **Compare pixels**: trace two pixels side by side; lines where they diverge are highlighted.
- Not in v1: `texture()` (stage 4), `dFdx/dFdy/fwidth` (later: run a 2×2 quad in lockstep).

### 2.4 Exercise checking

- **Image diff**: render your shader and the hidden reference to a 128×128 offscreen target; pass if ≥ X% of pixels are within tolerance (per-exercise). Animated exercises compare at several `u_time` values; resolution-sensitive exercises compare at two aspect ratios. On fail → **diff heatmap** overlay.
- **Pixel probes**: `{"at": [0.25, 0.5], "space": "uv", "expect": [1,0,0,1], "tol": 0.02}`, plus region rules ("all x < 0.5: r < 0.1").
- **Function tests** (from lesson 3 on): the interpreter calls *your* function: `{"call": "rect(vec2(0.5), vec2(0.2), vec2(0.8))", "expect": 1.0}`. Failing test → **"Step into this call"** opens the stepper on exactly that invocation.

### 2.5 AI tutor

**Interface** (server side, swappable):

```ts
interface TutorProvider {
  complete(req: TutorRequest): Promise<TutorResponse>;
}
type TutorRequest =
  | { kind: "line";  line: string; context: CodeContext }
  | { kind: "error"; error: CompileError; context: CodeContext }
  | { kind: "hint";  level: 1 | 2 | 3; context: CodeContext };
```

`CodeContext` = lesson goal, your code, cursor line, compile errors, traced values at the selected pixel (if any), hint level, reference JSON entries for built-ins in play, **teacher notes** for the current exercise. Never the reference solution.

- **Models**: tiered via env — a fast model for one-liners (`claude-haiku-5-5`), a stronger model for hints/errors (`claude-sonnet-5-5`). `ClaudeProvider` is the only implementation in v1.
- **Triggers**: one-line explainer for the cursor line (debounced, cached by hash of line + enclosing function + lesson id); "Explain this error" on compile errors (also maps the GPU's line number back through the line map); "I'm stuck" climbs the ladder.
- **Hint ladder**: L1 nudge (a question / "look at line N's value at this pixel"), L2 concept (name the idea or built-in, link the reference entry), L3 plain-English steps. Never GLSL that solves the exercise.
- **Guardrails**: system prompt + server-side output filter that rejects code fences / GLSL-shaped lines in exercise mode, retries once stricter, then falls back to a canned nudge. Outside exercises (free sandbox), small illustrative snippets of built-ins are allowed.
- Key lives in `server/.env`. Before any deploy: per-IP rate limit + optional bring-your-own-key field.

### 2.6 Editor & reference

CodeMirror 6 with custom extensions: GLSL syntax, compile-error squiggles, inline value widgets, gutter markers (probe point, current step), completion + hover docs + signature help from `reference/glsl-builtins.json`:

```json
{ "name": "smoothstep",
  "signatures": ["genType smoothstep(genType edge0, genType edge1, genType x)"],
  "oneLiner": "Smooth 0→1 ramp as x goes from edge0 to edge1.",
  "example": "float a = smoothstep(0.4, 0.5, d);",
  "introducedIn": "03-step",
  "spec": "https://registry.khronos.org/OpenGL-Refpages/es3.0/html/smoothstep.xhtml" }
```

Seeded with ~60 built-ins; grows lesson by lesson. The same entries are fed to the tutor to keep it grounded.

---

## 3. Lessons 1–3

Format, all stored in canonical dialect and shown in your chosen dialect:

```
lessons/01-coordinates/
  lesson.md                 intro, p5 bridge notes
  exercises/01-red-ramp/
    starter.glsl  reference.glsl  tests.json  notes.md (teacher notes)  predict.json
```

Every exercise has a **predict-then-reveal** step: pick a pixel, guess its value, then the stepper shows the actual trace.

### Lesson 1 — Coordinates & uv
p5 bridge: *"In p5 you'd loop over pixels. In a shader the loop is gone — `main()` runs once per pixel, all at once, and only knows where it is."*
1. **Red ramp** — predict `gl_FragCoord.x / 400.0` at x=100; then remove the hard-coded 400 with `u_resolution`. Tests: probes at left/right edges; diff at two resolutions.
2. **uv as color** — `vec2 uv = gl_FragCoord.xy / u_resolution` shown as RG. Discover the origin is **bottom-left** (p5 is top-left); flip y to match p5.
3. **Center the origin** — `uv * 2.0 - 1.0`; three-quarters of the screen gets hatched → first encounter with out-of-range values. Output `abs(uv)`.
4. **Aspect ratio** — on a wide canvas, make 1 unit equal in x and y so `length(uv)` produces a round (not oval) gradient.

### Lesson 2 — Color
1. **p5 colors → shader colors** — reproduce `fill(255, 128, 0)`; 0–255 becomes 0–1.
2. **Swizzling** — predict `uv.yxx`; match a target using only swizzles.
3. **mix** — horizontal gradient between two colors; vertical then diagonal.
4. **Out of range** — multiply by 2, see hatching, predict what the GPU shows; remap -1..1 with `* 0.5 + 0.5`.
5. **Time** — pulse with `sin(u_time)`; negative half hatched; fix it. Animated diff at several times.

### Lesson 3 — step & thresholds
1. **Hard edge** — predict `step(0.5, uv.x)`; split the screen at the mouse.
2. **Bands** — `1.0 - step`, and `step(a, x) * (1.0 - step(b, x))` for a stripe.
3. **Rectangle** — combine x and y bands; `*`/`min` as AND, `max` as OR.
4. **Your first function** — write `float rect(vec2 uv, vec2 lo, vec2 hi)`. Introduces **function tests** and "step into failing call".
5. **smoothstep** — soften edges; use value-as-image to watch the ramp; predict the value at the edge midpoint.

---

## 4. v1 milestones (Stage 1)

Each milestone ends in something usable.

| # | Milestone | Done when |
|---|---|---|
| M0 | **Skeleton** — Vite+TS, Express proxy stub, CM6 editor, WebGL2 runner with live recompile, error squiggles mapped to the right line. **Parser spike** (`@shaderfrog/glsl-parser`: ES 3.00 coverage, locations, round-trip printing). | Edit a shader, see it live, errors on correct lines; parser decision made. |
| M1 | **Value-as-image** — probe rewriter, raw+hatching / diverging / auto, hover readout. | Click any variable on any line and see it across the screen. |
| M2 | **Interpreter + stepper** — values, control flow, functions, ~60 built-ins (unit-tested), trace, timeline scrub, inline values, vars/stack panels, GPU cross-check, compare-pixels. | Click a pixel, scrub its full execution; cross-check agrees on a corpus of sample shaders. |
| M3 | **Lessons + checker** — loader, image diff + heatmap, probes, function tests + step-into, predict-then-reveal, localStorage progress, lessons 1–3 authored. | Complete lessons 1–3 end to end without AI. |
| M4 | **Tutor** — `TutorProvider` + `ClaudeProvider`, three triggers, hint ladder, output filter, caching. | Stuck on any lesson-1–3 exercise → useful hint, no solution code leaked. |
| M5 | **Dialects** — p5 / three / Shadertoy display, import, export with harnesses. | Paste a Shadertoy shader and debug it; export a lesson solution and run it in real p5 and three. |

Testing the tool itself: Vitest for built-ins, interpreter semantics, dialect round-trips, and probe rewriting; an in-app **self-test page** that runs the GPU-vs-interpreter cross-check on a shader corpus.

---

## 5. Road to the full pipeline

| Stage | Adds | Key debugger feature |
|---|---|---|
| **2. Vertex + mesh** | Built-in meshes (plane, sphere, cube → glTF), orbit camera, structs, vertex dialect adapters (p5 `aPosition`/`uModelViewMatrix`, three `position`/`modelViewMatrix`) | **Vertex stepper**: click a vertex, trace it (same interpreter, different inputs). Displacement/wave lessons. |
| **3. Rasterizer bridge** | Triangle picking, barycentric interpolation, depth & backface-culling views | Click a pixel on a mesh → see the triangle, its 3 vertices' varyings, the weights, the interpolated value → **step into that fragment**. The moment varyings make sense. |
| **4. Textures** | Image upload, samplers, `iChannel`/`tex0`/three textures | CPU `texture()` emulation (nearest/linear, wrap, approximate mips); see the texel(s) a sample read. Derivatives via 2×2 lockstep. |
| **5. Lighting & spaces** | Normals, normal matrix, Lambert/Phong | Visualize model → world → view → clip for a picked vertex. |
| **6. Multipass** | Shadertoy buffers, ping-pong feedback, p5 filter shaders, three post-processing, GPGPU particles | Inspect each pass; trace a pixel in pass B back into the pass-A pixel it sampled. |

Default order is 2 → 3 → 4 → 5 → 6. If your final leans on post-processing or feedback, Stage 6 jumps ahead of 4–5. Sandpack comes back here as a "run it in real p5/three" preview pane for exports.

---

## 6. Project layout

```
shader-debugger/
  server/
    index.ts                 Express: /api/tutor/{line,error,hint}
    tutor/ provider.ts  claude.ts  prompts.ts  filter.ts  cache.ts
  src/
    main.ts  store.ts
    glsl/        parse.ts  values.ts  builtins.ts  interpreter.ts  trace.ts
    dialects/    canonical.ts  p5.ts  three.ts  shadertoy.ts  es1to3.ts  linemap.ts  export/
    render/      runner.ts  probe.ts  visualize.glsl  diff.ts
    lessons/     loader.ts  checker.ts  progress.ts
    ui/          editor/  canvas.ts  stepper.ts  lessonPanel.ts  tutorPanel.ts
  lessons/       01-coordinates/  02-color/  03-step/
  reference/     glsl-builtins.json
  test/
```

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Parser doesn't cover ES 3.00 well or loses locations | M0 spike first; fallback is a hand-written parser for the subset we interpret. |
| Interpreter disagrees with GPU (precision, built-in edge cases) | float32 emulation everywhere, spec-based built-in tests, always-on cross-check with visible warning. |
| Line numbers drift through dialect conversion + injected headers | Single `linemap` module owned by the dialect layer; every error/value/marker goes through it; round-trip tests. |
| Tutor leaks solutions | It never sees them; output filter; teacher notes steer it. |
| Dialect details change between p5/three versions | Pin target versions in adapters; verify against current docs at M5. |
| Scope creep before v1 is usable | Milestones are ordered so M0–M3 alone is a useful tool without any AI. |
