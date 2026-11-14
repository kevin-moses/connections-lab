import { buildLessons } from './loader';

// Vite (and Vitest) inline the lesson files at build time. Teacher notes are
// left out: only the tutor server reads them, and the browser bundle is public.
const files = import.meta.glob(['/lessons/**/*.{md,json,glsl}', '!/lessons/**/notes.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const LESSONS = buildLessons(files);
