import { marked } from 'marked';
import type { TutorErrorBody, TutorRequest, TutorResponse } from '../../shared/tutor';

/** Ask the tutor proxy. Throws an Error whose message is safe to show. */
export async function askTutor(req: TutorRequest, signal?: AbortSignal): Promise<TutorResponse> {
  let res: Response;
  try {
    res = await fetch('/api/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error('The tutor server isn\'t running. Start it with `npm run dev`.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as TutorErrorBody | null;
    throw new Error(body?.error ?? `The tutor failed (${res.status}).`);
  }
  return (await res.json()) as TutorResponse;
}

const ALLOWED = new Set(['P', 'STRONG', 'EM', 'CODE', 'OL', 'UL', 'LI', 'BR', 'BLOCKQUOTE', 'PRE']);

/**
 * Model text → safe HTML: markdown, then keep only a few formatting tags
 * with no attributes. Anything else becomes plain text.
 */
export function tutorHtml(text: string): string {
  const t = document.createElement('template');
  t.innerHTML = marked.parse(text, { async: false }) as string;
  clean(t.content);
  return t.innerHTML;
}

function clean(node: Node): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (!ALLOWED.has(el.tagName)) {
        el.replaceWith(document.createTextNode(el.textContent ?? ''));
        continue;
      }
      for (const a of [...el.attributes]) el.removeAttribute(a.name);
      clean(el);
    } else if (child.nodeType !== Node.TEXT_NODE) {
      child.remove();
    }
  }
}

/** Same as tutorHtml but for one-liners: no wrapping paragraph. */
export function tutorInlineHtml(text: string): string {
  return tutorHtml(text).replace(/^<p>([\s\S]*)<\/p>\s*$/, '$1');
}
