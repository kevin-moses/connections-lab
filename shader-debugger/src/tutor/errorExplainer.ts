import type { CodeContext } from '../../shared/tutor';
import { Lru } from '../../shared/lru';
import { askTutor, tutorHtml, tutorInlineHtml } from './client';

/**
 * Explanations by exercise, line, that line's text, and message: they survive
 * recompiles while the same error stays on the same line, but not a move to
 * another exercise or an edit to the line itself.
 */
const explanations = new Lru<string>(100);

/**
 * An "Explain" button on a compile error in the Problems list. The answer
 * appears under the error, and comes back instantly while the error stays.
 */
export function addErrorExplainer(
  li: HTMLElement,
  msg: HTMLElement,
  error: { line: number | null; message: string },
  context: () => CodeContext,
): void {
  const ctx = context();
  const lineText = error.line ? (ctx.code.split('\n')[error.line - 1] ?? '') : '';
  const key = `${ctx.exerciseId ?? ''}|${error.line}|${lineText.trim()}|${error.message}`;
  const out = document.createElement('div');
  out.className = 'problem-explain';
  const show = (html: string) => {
    out.innerHTML = html;
    if (!out.isConnected) li.append(out);
  };
  const cached = explanations.get(key);
  if (cached) {
    show(cached);
    return;
  }
  const btn = document.createElement('button');
  btn.className = 'btn btn-quiet explain-btn';
  btn.textContent = 'Explain';
  btn.title = 'Ask the tutor what this error means';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    try {
      const r = await askTutor({ kind: 'error', error: { line: error.line, message: error.message }, context: context() });
      const html = tutorHtml(r.text);
      explanations.set(key, html);
      btn.remove();
      show(html);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Explain';
      show(`<span class="tutor-err">${tutorInlineHtml((err as Error).message)}</span>`);
    }
  });
  msg.append(btn);
}
