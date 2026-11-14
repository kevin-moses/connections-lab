import type { CodeContext, HintLevel, TutorRequest } from '../shared/tutor';

const MAX_CODE = 20_000;
const MAX_TEXT = 2_000;
const MAX_ITEMS = 40;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const int = (v: unknown): number | undefined => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : undefined);

/** Check and trim a request body. Returns the request, or an error message. */
export function parseTutorRequest(body: unknown): TutorRequest | string {
  if (!isObj(body)) return 'Expected a JSON object.';
  const context = parseContext(body.context);
  if (typeof context === 'string') return context;

  switch (body.kind) {
    case 'error': {
      const e = body.error;
      if (!isObj(e) || typeof e.message !== 'string') return '`error.message` is required.';
      return { kind: 'error', error: { line: int(e.line) ?? null, message: e.message.slice(0, MAX_TEXT) }, context };
    }
    case 'hint': {
      if (body.level !== 1 && body.level !== 2 && body.level !== 3) return '`level` must be 1, 2 or 3.';
      const previous = Array.isArray(body.previous) ? body.previous.slice(0, 6).map((p) => str(p) ?? '') : [];
      return { kind: 'hint', level: body.level as HintLevel, previous, context };
    }
    default:
      return '`kind` must be "error" or "hint".';
  }
}

function parseContext(v: unknown): CodeContext | string {
  if (!isObj(v) || typeof v.code !== 'string') return '`context.code` is required.';
  if (v.code.length > MAX_CODE) return 'That shader is too long for the tutor.';
  const ctx: CodeContext = { code: v.code };
  ctx.cursorLine = int(v.cursorLine);
  ctx.exerciseId = str(v.exerciseId, 200);
  if (Array.isArray(v.errors)) {
    ctx.errors = v.errors
      .slice(0, MAX_ITEMS)
      .filter(isObj)
      .map((e) => ({ line: int(e.line) ?? null, message: str(e.message) ?? '' }));
  }
  if (Array.isArray(v.checks)) {
    ctx.checks = v.checks
      .slice(0, MAX_ITEMS)
      .filter(isObj)
      .map((c) => ({ label: str(c.label, 300) ?? '', passed: c.passed === true, detail: str(c.detail, 500) }));
  }
  const t = v.trace;
  const traceLine = isObj(t) ? int(t.line) : undefined;
  if (isObj(t) && traceLine) {
    const px = Array.isArray(t.pixel) && t.pixel.length === 2 && t.pixel.every(Number.isFinite) ? (t.pixel as [number, number]) : null;
    ctx.trace = {
      pixel: px,
      call: str(t.call, 300) ?? null,
      line: traceLine,
      step: str(t.step, 300) ?? '',
      vars: Array.isArray(t.vars)
        ? t.vars
            .slice(0, MAX_ITEMS)
            .filter(isObj)
            .map((x) => ({ name: str(x.name, 80) ?? '?', value: str(x.value, 300) ?? '' }))
        : [],
      output: str(t.output, 300) ?? null,
    };
  }
  return ctx;
}
