import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { glsl } from './glslLanguage';
import type { ShaderDiagnostic } from '../glsl/diagnostics';

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--text)' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13.5px', lineHeight: '1.6' },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--text-faint)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--text-dim)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--selection) !important',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--panel)',
      border: '1px solid var(--border)',
      color: 'var(--text)',
    },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--error)' },
    '.cm-probe-line': { backgroundColor: 'var(--probe-line)', boxShadow: 'inset 2px 0 0 var(--accent)' },
    '.cm-probe-expr': {
      backgroundColor: 'var(--probe-expr)',
      borderRadius: '2px',
      outline: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)',
    },
    '.cm-exec-line': { backgroundColor: 'var(--exec-line)', boxShadow: 'inset 3px 0 0 var(--exec)' },
    // A background *image* so it layers with the exec line's background color.
    '.cm-diverge-line': {
      backgroundImage: 'linear-gradient(90deg, rgba(240, 125, 232, 0.16), rgba(240, 125, 232, 0.04) 60%, transparent)',
    },
    '.cm-inline-value': {
      marginLeft: '1.5em',
      padding: '0 6px',
      borderRadius: '3px',
      fontSize: '12px',
      color: 'var(--inline-value)',
      backgroundColor: 'var(--inline-value-bg)',
      whiteSpace: 'pre',
    },
    '.cm-inline-value.current': { color: 'var(--text)', backgroundColor: 'var(--exec-chip)' },
    '.cm-inline-value .b': { color: 'var(--pixel-b)' },
    '.cm-inline-value .sep': { color: 'var(--text-faint)', margin: '0 6px' },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--error)',
      textUnderlineOffset: '3px',
    },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: [t.typeName], color: 'var(--syn-type)' },
  { tag: [t.standard(t.variableName), t.function(t.variableName)], color: 'var(--syn-builtin)' },
  { tag: [t.atom, t.bool], color: 'var(--syn-atom)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--syn-meta)' },
  { tag: t.operator, color: 'var(--text-dim)' },
]);

/** Where the value-as-image probe is attached, for highlighting. */
export interface ProbeMarker {
  line: number;
  exprRange: [number, number] | null;
}

const setProbeMarker = StateEffect.define<ProbeMarker | null>();

const probeLineDeco = Decoration.line({ class: 'cm-probe-line' });
const probeExprDeco = Decoration.mark({ class: 'cm-probe-expr' });

const probeMarkerField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setProbeMarker)) continue;
      const m = e.value;
      if (!m || m.line < 1 || m.line > tr.state.doc.lines) {
        decos = Decoration.none;
        continue;
      }
      const ranges = [probeLineDeco.range(tr.state.doc.line(m.line).from)];
      const [from, to] = m.exprRange ?? [0, 0];
      if (m.exprRange && from < to && to <= tr.state.doc.length) ranges.push(probeExprDeco.range(from, to));
      decos = Decoration.set(ranges, true);
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** What the single-pixel stepper wants shown in the editor. */
export interface DebugDecorations {
  /** Line of the current step. */
  execLine: number | null;
  /** Values at line ends: latest step at or before the current one. */
  inline: { line: number; text: string; textB?: string | null; current: boolean }[];
  /** Lines where pixel A and pixel B ran differently. */
  diverge: number[];
}

class InlineValueWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly textB: string | null,
    readonly current: boolean,
  ) {
    super();
  }
  eq(other: InlineValueWidget) {
    return other.text === this.text && other.textB === this.textB && other.current === this.current;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-inline-value${this.current ? ' current' : ''}`;
    el.textContent = this.text;
    if (this.textB !== null) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '│';
      const b = document.createElement('span');
      b.className = 'b';
      b.textContent = this.textB || '—';
      el.append(sep, b);
    }
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const setDebugDecorations = StateEffect.define<DebugDecorations | null>();
const execLineDeco = Decoration.line({ class: 'cm-exec-line' });
const divergeLineDeco = Decoration.line({ class: 'cm-diverge-line' });

const debugField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setDebugDecorations)) continue;
      const d = e.value;
      const doc = tr.state.doc;
      if (!d) {
        decos = Decoration.none;
        continue;
      }
      const ranges = [];
      const valid = (l: number) => l >= 1 && l <= doc.lines;
      for (const l of d.diverge) if (valid(l)) ranges.push(divergeLineDeco.range(doc.line(l).from));
      if (d.execLine !== null && valid(d.execLine)) ranges.push(execLineDeco.range(doc.line(d.execLine).from));
      for (const v of d.inline) {
        if (!valid(v.line)) continue;
        const widget = Decoration.widget({ widget: new InlineValueWidget(v.text, v.textB ?? null, v.current), side: 1 });
        ranges.push(widget.range(doc.line(v.line).to));
      }
      decos = Decoration.set(ranges, true);
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface ShaderEditor {
  view: EditorView;
  getSource(): string;
  getCursor(): number;
  showDiagnostics(diags: ShaderDiagnostic[]): void;
  showProbe(marker: ProbeMarker | null): void;
  showDebug(decos: DebugDecorations | null): void;
  /** 1-based line the cursor is on. */
  cursorLine(): number;
  jumpToLine(line: number): void;
  /** Scroll a line into view without moving the cursor. */
  revealLine(line: number): void;
  /** Swap in new code with a fresh undo history (e.g. switching exercises). */
  replaceDocument(doc: string): void;
}

export function createEditor(
  parent: HTMLElement,
  initialDoc: string,
  onChange: (source: string) => void,
  onCursor: (offset: number) => void = () => {},
): ShaderEditor {
  const extensions: Extension[] = [
    basicSetup,
    keymap.of([indentWithTab]),
    glsl,
    syntaxHighlighting(highlight),
    theme,
    lintGutter(),
    probeMarkerField,
    debugField,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
      else if (u.selectionSet) onCursor(u.state.selection.main.head);
    }),
  ];

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: initialDoc, extensions }),
  });

  return {
    view,
    getSource: () => view.state.doc.toString(),
    getCursor: () => view.state.selection.main.head,
    showProbe(marker) {
      view.dispatch({ effects: setProbeMarker.of(marker) });
    },
    showDebug(decos) {
      view.dispatch({ effects: setDebugDecorations.of(decos) });
    },
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    replaceDocument(doc) {
      view.setState(EditorState.create({ doc, extensions }));
    },
    revealLine(line) {
      const doc = view.state.doc;
      if (line < 1 || line > doc.lines) return;
      view.dispatch({ effects: EditorView.scrollIntoView(doc.line(line).from, { y: 'nearest' }) });
    },
    showDiagnostics(diags) {
      view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state, diags)));
    },
    jumpToLine(line) {
      const doc = view.state.doc;
      const pos = doc.line(Math.min(Math.max(1, line), doc.lines)).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    },
  };
}

/** Convert line/column diagnostics to CodeMirror document offsets. */
function toCmDiagnostics(state: EditorState, diags: ShaderDiagnostic[]): Diagnostic[] {
  const doc = state.doc;
  return diags
    .filter((d) => d.line !== null && d.line >= 1 && d.line <= doc.lines)
    .map((d) => {
      const line = doc.line(d.line!);
      const indent = line.text.length - line.text.trimStart().length;
      const hasRange = d.from !== undefined;
      const from = line.from + (hasRange ? Math.min(d.from!, line.length) : indent);
      let to = line.from + (d.to !== undefined ? Math.min(d.to, line.length) : line.length);
      if (to <= from) to = Math.min(from + 1, line.to);
      return { from, to, severity: d.severity, message: d.message, source: d.origin };
    });
}
