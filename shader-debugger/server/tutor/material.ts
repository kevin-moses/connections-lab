import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { splitTitle } from '../../shared/lessonFiles';

/**
 * What the tutor may know about an exercise: the lesson intro, the exercise
 * prompt and title, and the teacher notes. Read from disk on the server so
 * the browser can't swap them. The reference solution is never read here.
 */
export interface ExerciseMaterial {
  id: string;
  lessonTitle: string;
  lessonIntro: string;
  title: string;
  prompt: string;
  notes: string;
}

/** The only files this module opens, in this order. `reference.glsl` is deliberately absent. */
export const MATERIAL_FILES = ['lesson.md', 'exercise.json', 'prompt.md', 'notes.md'] as const;

const DEFAULT_ROOT = fileURLToPath(new URL('../../lessons/', import.meta.url));
const ID = /^([\w-]+)\/([\w-]+)$/;

export type MaterialLoader = (exerciseId: string) => Promise<ExerciseMaterial | null>;

/**
 * Files are read once per exercise and kept: they don't change while the
 * server runs (`npm run dev` restarts it when anything in lessons/ changes).
 */
export function createMaterialLoader(root = DEFAULT_ROOT): MaterialLoader {
  const loaded = new Map<string, Promise<ExerciseMaterial | null>>();
  return (exerciseId) => {
    let p = loaded.get(exerciseId);
    if (!p) {
      p = load(root, exerciseId);
      loaded.set(exerciseId, p);
      // Only real exercises stay cached, so made-up ids can't grow the map.
      p.then((m) => m ?? loaded.delete(exerciseId));
    }
    return p;
  };
}

async function load(root: string, exerciseId: string): Promise<ExerciseMaterial | null> {
  const m = ID.exec(exerciseId);
  if (!m) return null;
  const [, lessonId, slug] = m;
  const lessonDir = path.join(root, lessonId);
  const exDir = path.join(lessonDir, 'exercises', slug);
  const read = (file: string) => readFile(path.join(file === 'lesson.md' ? lessonDir : exDir, file), 'utf8').catch(() => null);

  const [lessonMd, json, prompt, notes] = await Promise.all(MATERIAL_FILES.map(read));
  if (lessonMd === null || json === null || prompt === null) return null;

  let title = slug;
  try {
    title = (JSON.parse(json) as { title?: string }).title ?? slug;
  } catch {
    /* keep the slug */
  }
  const lesson = splitTitle(lessonMd, lessonId);
  return {
    id: exerciseId,
    lessonTitle: lesson.title,
    lessonIntro: lesson.body,
    title,
    prompt: prompt.trim(),
    notes: (notes ?? '').trim(),
  };
}
