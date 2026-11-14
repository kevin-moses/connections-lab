/**
 * Output screen for exercise mode: the tutor may talk about the learner's
 * code, quote it, and name built-ins, but must not hand over new GLSL that
 * solves (part of) the exercise. Heuristic by design: the system prompt does
 * the real work; this catches the slips.
 */

export type Screen = { ok: true } | { ok: false; reason: string };

export interface ScreenOptions {
  exerciseMode: boolean;
  /** The learner's code: quoting it back is always allowed. */
  learnerCode: string;
}

const TYPES = 'float|int|uint|bool|[biu]?vec[234]|mat[234](?:x[234])?';
const DECLARATION = new RegExp(`^\\s*(?:const\\s+)?(?:${TYPES})\\s+[A-Za-z_]\\w*\\s*(?:=|;|\\()`);
/** `x = ...`, `uv.x *= 2.0`, `fragColor = vec4(...)` (but not `==`, `<=`, ...). */
const ASSIGNMENT = /^\s*[A-Za-z_][\w.[\]]*\s*(?:[-+*/]?=)(?!=)/;
/** Names that never count as "the learner's variables". */
const UNIFORMS = new Set(['u_resolution', 'u_time', 'u_mouse', 'gl_FragCoord', 'fragColor', 'gl_FragColor']);

const FENCE = /```[^\n]*\n?([\s\S]*?)```/g;

/** Sandbox: allow small illustrative snippets; only very long code blocks are refused. */
const SANDBOX_MAX_BLOCK_LINES = 6;

export function screenOutput(text: string, opts: ScreenOptions): Screen {
  const code = normalize(opts.learnerCode);
  const inLearnerCode = (s: string) => {
    const n = normalize(s);
    return n.length > 0 && code.includes(n);
  };

  // Non-blank lines of each fenced code block.
  const blocks = [...text.matchAll(FENCE)].map((f) => f[1].split('\n').filter((l) => l.trim()));
  if (!opts.exerciseMode) {
    return blocks.some((b) => b.length > SANDBOX_MAX_BLOCK_LINES) ? { ok: false, reason: 'a long code block' } : { ok: true };
  }

  // Exercise mode.
  if (!blocks.every((b) => b.every(inLearnerCode))) return { ok: false, reason: 'a code block' };

  const vars = learnerVariables(opts.learnerCode);
  const prose = text.replace(FENCE, ' ');
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1];
    if (inLearnerCode(span)) continue;
    const why = codeLike(span, vars);
    if (why) return { ok: false, reason: `${why}: \`${span}\`` };
  }

  // Bare GLSL lines outside backticks.
  for (const line of prose.replace(/`[^`\n]*`/g, '').split('\n')) {
    const t = line.trim().replace(/^[-*\d.)\s]+/, '');
    if (!t.endsWith(';') || inLearnerCode(t)) continue;
    if (DECLARATION.test(t) || ASSIGNMENT.test(t)) return { ok: false, reason: `a line of code: ${t}` };
  }
  return { ok: true };
}

/** Why a code span counts as handing over code, or null if it's fine. */
function codeLike(span: string, learnerVars: Set<string>): string | null {
  if (span.includes(';')) return 'a statement';
  if (DECLARATION.test(span)) return 'a declaration';
  if (ASSIGNMENT.test(span)) return 'an assignment';
  // An expression built from the learner's own variables (`bandX * bandY`,
  // `step(0.3, uv.y)`) is a piece of their solution. Names alone (`uv.x`),
  // built-ins on placeholders (`step(edge, x)`) and literals are fine.
  const usesTheirVars = [...span.matchAll(/[A-Za-z_]\w*/g)].some((m) => learnerVars.has(m[0]));
  const isExpression = /[-+*/<>?]|[A-Za-z_]\w*\s*\(/.test(span.replace(/^-/, ''));
  if (usesTheirVars && isExpression) return 'an expression using your variables';
  return null;
}

/** Names the learner declared (variables, parameters, functions). */
export function learnerVariables(code: string): Set<string> {
  const names = new Set<string>();
  const decl = new RegExp(`\\b(?:${TYPES}|void)\\s+([A-Za-z_]\\w*)`, 'g');
  for (const m of stripComments(code).matchAll(decl)) {
    if (!UNIFORMS.has(m[1]) && m[1] !== 'main') names.add(m[1]);
  }
  return names;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
}

/** Whitespace-insensitive form for "is this quoted from their code?". */
function normalize(s: string): string {
  return stripComments(s).replace(/\s+/g, '');
}
