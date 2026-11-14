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
