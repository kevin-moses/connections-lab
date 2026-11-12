import type { Exercise, ExerciseConfig, Lesson } from './types';

/**
 * Build lessons from a map of file path → contents, e.g.
 * `/lessons/01-coordinates/exercises/01-red-ramp/starter.glsl`.
 * Folders are ordered by name, so number them.
 */
export function buildLessons(files: Record<string, string>): Lesson[] {
  const lessons = new Map<string, Lesson>();
  const exercises = new Map<string, Partial<Record<string, string>>>();

  for (const [path, text] of Object.entries(files)) {
    const m = /\/lessons\/([^/]+)\/(?:exercises\/([^/]+)\/)?([^/]+)$/.exec(path);
    if (!m) continue;
    const [, lessonId, exerciseSlug, file] = m;
    if (!exerciseSlug) {
      if (file === 'lesson.md') {
        const { title, body } = splitTitle(text, lessonId);
        lessons.set(lessonId, { id: lessonId, index: 0, title, intro: body, exercises: [] });
      }
      continue;
    }
    const key = `${lessonId}/${exerciseSlug}`;
    const entry = exercises.get(key) ?? {};
    entry[file] = text;
    exercises.set(key, entry);
  }

  for (const [id, f] of exercises) {
    const [lessonId] = id.split('/');
    const lesson = lessons.get(lessonId);
    if (!lesson) throw new Error(`Exercise ${id} has no lesson.md`);
    for (const required of ['exercise.json', 'prompt.md', 'starter.glsl', 'reference.glsl']) {
      if (f[required] === undefined) throw new Error(`Exercise ${id} is missing ${required}`);
    }
    let config: ExerciseConfig;
    try {
      config = JSON.parse(f['exercise.json']!);
    } catch (e) {
      throw new Error(`Exercise ${id}: bad exercise.json (${(e as Error).message})`);
    }
    lesson.exercises.push({
      id,
      lessonId,
      index: 0,
      config,
      prompt: f['prompt.md']!,
      starter: f['starter.glsl']!,
      reference: f['reference.glsl']!,
      notes: f['notes.md'] ?? '',
    } satisfies Exercise);
  }

  const ordered = [...lessons.values()].sort((a, b) => a.id.localeCompare(b.id));
  ordered.forEach((lesson, i) => {
    lesson.index = i;
    lesson.exercises.sort((a, b) => a.id.localeCompare(b.id));
    lesson.exercises.forEach((ex, j) => (ex.index = j));
  });
  return ordered;
}

function splitTitle(markdown: string, fallback: string): { title: string; body: string } {
  const m = /^\s*#\s+(.+)\n?/.exec(markdown);
  return m ? { title: m[1].trim(), body: markdown.slice(m[0].length).trim() } : { title: fallback, body: markdown.trim() };
}
