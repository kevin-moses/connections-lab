import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { TutorRequest } from '../shared/tutor';

/** The dev-only handle main.ts puts on window. */
type Sd = {
  editor: { view: { state: { doc: { toString(): string; length: number; line(n: number): { from: number } } }; dispatch(tr: unknown): void; focus(): void; coordsAtPos(pos: number): { left: number; top: number; bottom: number } | null } };
  lessons: { open(id: string): void; current: { id: string } };
};
declare global {
  interface Window {
    __sd: Sd;
  }
}

export function lessonFile(exerciseId: string, file: string): string {
  return readFileSync(`lessons/${exerciseId.replace('/', '/exercises/')}/${file}`, 'utf8');
}

export async function setCode(page: Page, code: string) {
  await page.evaluate((c) => {
    const v = window.__sd.editor.view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } });
  }, code);
}

export async function cursorToLine(page: Page, line: number) {
  await page.evaluate((n) => {
    const v = window.__sd.editor.view;
    v.dispatch({ selection: { anchor: v.state.doc.line(n).from } });
  }, line);
}

export async function openExercise(page: Page, id: string) {
  await page.evaluate((x) => window.__sd.lessons.open(x), id);
}

/** Answer /api/* without a server or a key; returns the tutor requests seen. */
export async function mockTutor(page: Page, answers: Partial<Record<TutorRequest['kind'], string>> = {}) {
  const requests: TutorRequest[] = [];
  await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true, provider: 'mock', live: true } }));
  await page.route('**/api/tutor', async (route) => {
    const req = route.request().postDataJSON() as TutorRequest;
    requests.push(req);
    await route.fulfill({ json: { text: answers[req.kind] ?? `A ${req.kind} answer.`, provider: 'mock' } });
  });
  return requests;
}
