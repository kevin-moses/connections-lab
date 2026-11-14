/**
 * Lesson-file conventions shared by the browser (which bundles lessons) and
 * the tutor server (which reads them from disk).
 */

/** A markdown file's `# Title` and the rest. */
export function splitTitle(markdown: string, fallback: string): { title: string; body: string } {
  const m = /^\s*#\s+(.+)\n?/.exec(markdown);
  return m ? { title: m[1].trim(), body: markdown.slice(m[0].length).trim() } : { title: fallback, body: markdown.trim() };
}
