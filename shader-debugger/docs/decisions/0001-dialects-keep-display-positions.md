# 1. Dialects: parse what the learner sees; convert only for the GPU and export

Status: accepted, for M5 (p5 / three.js / Shadertoy dialects)

## Context

Every tool in the app reads positions in the editor's text:

- the probe target resolves the editor cursor as a character offset into the source (`resolveProbeTarget(ast, source, cursor)`), and the probe rewriter splices into that same source;
- the Debugger reports lines and inline values per line;
- the tutor numbers lines, finds the enclosing function (`shared/scope.ts`) and names the learner's variables;
- the line explainer and error explainer cache by line text.

Only the path to the GPU changes the text today: `prepareFragmentSource` injects a `#version` line and maps the GPU's error lines back with a `LineMap`.

M5 lets the learner write in a dialect (p5's ES 1.00 style, three.js `ShaderMaterial`, Shadertoy's `mainImage`) while the app runs one canonical form.

## Decision

Parse and analyze **the text the learner sees**, in its own dialect. Convert to canonical GLSL ES 3.00 only on the way out:

- **to the GPU** (normal render, probe shaders, checker renders): an AST-based conversion that returns code plus a `LineMap`, extending what `prepareFragmentSource` does for `#version`;
- **to export**: the same conversion plus a runnable harness.

The interpreter, probe rewriter, Debugger, tutor and explainers keep working on display positions. They learn the dialect's *names* instead of having their positions translated: e.g. `gl_FragColor` is the output, `iResolution` is `u_resolution`, `fragCoord` is `gl_FragCoord`, `mainImage(out vec4, in vec2)` is the entry point. One table per dialect, owned by the dialect module, read by the interpreter's global setup and the probe rewriter.

## Alternatives considered

**Convert the text first, analyze the canonical text.** Simpler conversion, but every consumer above would need to map offsets and lines in both directions, and the tutor would quote code the learner never wrote. Rejected: many mapping sites, each a place for off-by-one bugs.

## Consequences

- `prepareFragmentSource(source)` becomes `prepareFragmentSource(source, dialect)`; every GPU caller already goes through it (`render/fullscreen.ts`).
- The interpreter needs a small name table per dialect (output variable, coordinate input, uniform aliases, entry point).
- Lesson checks render the learner's code through the same path, so they work in any dialect. Lessons stay authored in canonical form; showing them in another dialect is a display conversion with its own `LineMap`, only for the starter text.
- Tests: for each dialect, round-trip the corpus (`src/interp/corpus.ts`) through conversion and assert GPU output and interpreter output match the canonical version, and that error lines map back.

## Update: verified facts and the p5 slice (Nov 2026)

Checked against p5.js 2.4.0 and three.js r187 source, and measured in a real p5 2.4.0 sketch in Chrome:

- **p5** (2.4.0 is current; 1.11.13 is the last 1.x). It adds nothing to user shaders: no `#version`, precision or `#define`s. Without `#version` it compiles them as GLSL ES 1.00 (`Shader.version()` returns `'100 es'`) on a WebGL2 context, which is the default. It supplies no time, resolution or mouse uniforms, and `setUniform` on an undeclared name silently does nothing. On a full-canvas `plane()` or `rect()`, `vTexCoord` is (0, 0) at the **top-left** with y down, so `vTexCoord.y = 1 − gl_FragCoord.y / height`.
- **three.js** (r187, WebGL2 only since r163). `ShaderMaterial` always prepends `#version 300 es`, precision, `#define varying in`, `#define texture2D texture`, `layout(location = 0) out highp vec4 pc_fragColor;` and `#define gl_FragColor pc_fragColor`, so ES 1.00-style fragment code runs as-is. With `glslVersion: GLSL3`, the `pc_fragColor` lines are dropped and you declare your own `out`. `RawShaderMaterial` prepends nothing.

Decisions for M5:

1. **p5 first**, then Shadertoy, then three.js.
2. **The GPU path detects the style from the code.** ES 3.00 must declare an `out`; ES 1.00 writes `gl_FragColor`. So `prepareFragmentSource` converts ES 1.00 code the way three.js does (`#define`s plus one output declaration, lines mapped back) without being told a dialect. The dialect setting only controls how code is **shown** and **exported**.
3. **Lessons stay ES 3.00.** A language dropdown shows starters and the learner's code in p5 style (`gl_FragColor`, `varying vec2 vTexCoord`, `texture2D`), converted with the parser.
4. **Exports target p5 2.x** (inline `createShader`, uniforms set every frame), which also runs on 1.x.
5. **Uniform names stay `u_resolution` / `u_time` / `u_mouse`** in every dialect, including three.js. Only Shadertoy renames (`iTime`, `iResolution`, `iMouse`).
6. The app supplies `vTexCoord` with p5's orientation in every style, on the GPU (fullscreen vertex shader) and on the CPU (interpreter input).

### Shadertoy (done)

- **Detected from the code**, like p5: it defines `mainImage` and no `main`. The GPU wraps it as shadertoy.com does: one header line declaring its inputs, then `main()` calling `mainImage(c, gl_FragCoord.xy)` with alpha forced to 1. The interpreter starts at `mainImage`, and the probe rewriter's `main` calls it. Display positions stay untouched, as this ADR decided.
- **One input table** (`src/glsl/shadertoy.ts`) derives `iResolution`, `iTime`, `iMouse`, `iFrame`, … from the app's `u_resolution` / `u_time` / `u_mouse`, for the GPU header, the uniform setter and the interpreter, so the cross-check can't drift.
- **Conversion goes through ES 3.00** (`src/dialects/convert.ts`): p5 ↔ ES 3.00 ↔ Shadertoy. `u_resolution` becomes `iResolution.xy`, or just `iResolution` when it's already swizzled to x/y. Going back, `iResolution` becomes `u_resolution`, or `vec3(u_resolution, 1.0)` when its `.z` is used. Inputs with no app equivalent (`iFrame`, …) keep their names as declared uniforms.

### three.js (done)

- **No separate display style.** A `ShaderMaterial` fragment shader is ES 1.00 code (three `#define`s `gl_FragColor`, `varying` and `texture2D`, the way our GPU path does) or ES 3.00 code with `glslVersion: GLSL3`. So p5 style and ES 3.00 cover it. What three.js code needed: a `precision` line added when missing (three adds its own), and three's usual `vUv` varying (origin bottom-left), supplied alongside p5's `vTexCoord`.
- **Export**: a page loading three r187 through an import map; a `PlaneGeometry(2, 2)` whose positions are already clip space; a `ShaderMaterial` with `u_resolution` / `u_time` / `u_mouse` (decision 5), drawing-buffer-sized for `gl_FragCoord`. three writes its own `#version`, so the export removes the learner's. Verified against real three r187: ShaderMaterial output gets no color-space conversion, so pixels match the app.

