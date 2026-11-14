import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';
import { GLSL_REFERENCE, lookupGlsl, specUrl, type GlslEntry } from '../../shared/glslReference';

const KEYWORDS = `const uniform in out inout precision highp mediump lowp break continue discard return for while do if else struct
void bool int uint float vec2 vec3 vec4 bvec2 bvec3 bvec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 mat2 mat3 mat4 true false`.split(/\s+/);

const OPTIONS: Completion[] = [
  ...GLSL_REFERENCE.map((e) => ({
    label: e.name,
    type: e.kind === 'function' ? 'function' : 'variable',
    // Functions: the parameter list; inputs: their type.
    detail: e.kind === 'function' ? e.signatures[0].slice(e.signatures[0].indexOf('(')) : e.signatures[0],
    info: () => entryDom(e),
    boost: e.kind === 'variable' ? 1 : 0,
  })),
  ...KEYWORDS.map((k) => ({ label: k, type: 'keyword' })),
];

function complete(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/[A-Za-z_]\w*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  // Not inside comments.
  const line = ctx.state.doc.lineAt(ctx.pos);
  if (line.text.slice(0, ctx.pos - line.from).includes('//')) return null;
  return { from: word.from, options: OPTIONS, validFor: /^\w*$/ };
}

function entryDom(e: GlslEntry): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-glsl-doc';
  const sig = document.createElement('div');
  sig.className = 'cm-glsl-sig';
  sig.textContent = e.signatures.join('\n');
  const text = document.createElement('div');
  text.textContent = e.oneLiner;
  dom.append(sig, text);
  if (e.example) {
    const ex = document.createElement('code');
    ex.className = 'cm-glsl-example';
    ex.textContent = e.example;
    dom.append(ex);
  }
  if (e.debuggable === false) {
    const note = document.createElement('div');
    note.className = 'cm-glsl-note';
    note.textContent = 'Runs on the GPU, but the Debugger can’t step through it yet.';
    dom.append(note);
  }
  if (e.kind === 'function') {
    const link = document.createElement('a');
    link.href = specUrl(e.name);
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Spec';
    dom.append(link);
  }
  return dom;
}

/** Hover a built-in (or an app input like `u_time`) to see what it does. */
const hoverDocs = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const at = pos - line.from;
  let start = at;
  let end = at;
  while (start > 0 && /\w/.test(line.text[start - 1])) start--;
  while (end < line.text.length && /\w/.test(line.text[end])) end++;
  if (start === end || line.text.slice(0, start).includes('//')) return null;
  const entry = lookupGlsl(line.text.slice(start, end));
  if (!entry) return null;
  return { pos: line.from + start, end: line.from + end, above: true, create: () => ({ dom: entryDom(entry) }) };
});

/** Completion and hover docs for GLSL built-ins, from the shared reference. */
export function glslReference(): Extension {
  return [EditorState.languageData.of(() => [{ autocomplete: complete }]), hoverDocs];
}
