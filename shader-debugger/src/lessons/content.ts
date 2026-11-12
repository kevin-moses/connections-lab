import { buildLessons } from './loader';

// Vite (and Vitest) inline every lesson file at build time.
const files = import.meta.glob('/lessons/**/*.{md,json,glsl}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const LESSONS = buildLessons(files);
