import type { TraceStep } from '../interp/interpreter';

/** Next step that isn't deeper than the current one (skips over calls). */
export function stepOver(steps: TraceStep[], cur: number): number {
  const depth = steps[cur]?.depth ?? 0;
  for (let j = cur + 1; j < steps.length; j++) if (steps[j].depth <= depth) return j;
  return steps.length - 1;
}

/** Previous step that isn't deeper than the current one. */
export function stepBackOver(steps: TraceStep[], cur: number): number {
  const depth = steps[cur]?.depth ?? 0;
  for (let j = cur - 1; j >= 0; j--) if (steps[j].depth <= depth) return j;
  return 0;
}

/** First step after leaving the current function. */
export function stepOut(steps: TraceStep[], cur: number): number {
  const depth = steps[cur]?.depth ?? 0;
  if (depth === 0) return steps.length - 1;
  for (let j = cur + 1; j < steps.length; j++) if (steps[j].depth < depth) return j;
  return steps.length - 1;
}

/** Next step on `line` (wrapping to the first one), or null if it never runs. */
export function runToLine(steps: TraceStep[], cur: number, line: number): number | null {
  for (let j = cur + 1; j < steps.length; j++) if (steps[j].line === line) return j;
  for (let j = 0; j <= cur && j < steps.length; j++) if (steps[j].line === line) return j;
  return null;
}

export interface InlineValue {
  line: number;
  text: string;
  step: number;
}

/**
 * For every line that has run so far, the most recent step's description.
 * Steps with nothing to say (a call that changed nothing) are skipped.
 */
export function inlineValues(steps: TraceStep[], cur: number): InlineValue[] {
  const byLine = new Map<number, InlineValue>();
  for (let i = 0; i <= cur && i < steps.length; i++) {
    const s = steps[i];
    if (!s.text || s.kind === 'call') continue;
    const pass = s.loopIter && s.kind !== 'loop' ? `  · pass ${s.loopIter}` : '';
    byLine.set(s.line, { line: s.line, text: clip(s.text) + pass, step: i });
  }
  return [...byLine.values()];
}

/** How many earlier steps in this trace ran on the same line. */
function occurrence(steps: TraceStep[], index: number): number {
  const line = steps[index].line;
  let k = 0;
  for (let i = 0; i < index; i++) if (steps[i].line === line) k++;
  return k;
}

/**
 * The step in trace B that corresponds to step `cur` of trace A: the same
 * line, the same number of times in. Null when B never got that far.
 */
export function alignStep(a: TraceStep[], cur: number, b: TraceStep[]): number | null {
  if (!a[cur]) return null;
  const line = a[cur].line;
  const k = occurrence(a, cur);
  let seen = 0;
  for (let j = 0; j < b.length; j++) {
    if (b[j].line !== line) continue;
    if (seen === k) return j;
    seen++;
  }
  return null;
}

/** Latest step at or before `cur` on each line, as B's inline text. */
export function inlineValuesAligned(a: TraceStep[], cur: number, b: TraceStep[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const v of inlineValues(a, cur)) {
    const j = alignStep(a, v.step, b);
    out.set(v.line, j === null ? '' : clip(b[j].text));
  }
  return out;
}

/** Lines that ran a different number of times, or took a different branch. */
export function divergentLines(a: TraceStep[], b: TraceStep[]): number[] {
  const count = (steps: TraceStep[]) => {
    const m = new Map<number, number>();
    for (const s of steps) m.set(s.line, (m.get(s.line) ?? 0) + 1);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  const lines = new Set<number>();
  for (const l of new Set([...ca.keys(), ...cb.keys()])) if (ca.get(l) !== cb.get(l)) lines.add(l);

  const branches = (steps: TraceStep[]) => steps.filter((s) => s.kind === 'branch');
  const ba = branches(a);
  const bb = branches(b);
  for (let i = 0; i < Math.min(ba.length, bb.length); i++) {
    if (ba[i].line === bb[i].line && ba[i].text !== bb[i].text) lines.add(ba[i].line);
  }
  return [...lines].sort((x, y) => x - y);
}

function clip(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
