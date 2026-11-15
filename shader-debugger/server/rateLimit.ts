import type { RequestHandler } from 'express';
import type { TutorErrorBody } from '../shared/tutor';

/**
 * Fixed-window request limit per client IP. Model calls cost money, so a
 * stuck client (or anyone else who reaches the proxy) can't run up a bill.
 */
export function rateLimit({ max, windowMs }: { max: number; windowMs: number }): RequestHandler {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    if (windows.size > 1000) {
      for (const [ip, w] of windows) if (w.resetAt <= now) windows.delete(ip);
    }
    const ip = req.ip ?? 'unknown';
    let w = windows.get(ip);
    if (!w || w.resetAt <= now) windows.set(ip, (w = { count: 0, resetAt: now + windowMs }));
    if (++w.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((w.resetAt - now) / 1000)));
      res.status(429).json({ error: 'Too many tutor requests. Wait a minute and try again.' } satisfies TutorErrorBody);
      return;
    }
    next();
  };
}

/**
 * A cap on all tutor requests per UTC day, whoever sends them: the most a
 * public deploy can spend in a day. Counted in memory, so a restart resets it.
 */
export function dailyCap({ max, now = () => Date.now() }: { max: number; now?: () => number }): RequestHandler {
  let day = '';
  let count = 0;
  return (_req, res, next) => {
    const t = now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      count = 0;
    }
    if (++count > max) {
      const midnight = Date.parse(`${today}T00:00:00Z`) + 86_400_000;
      res.setHeader('Retry-After', String(Math.ceil((midnight - t) / 1000)));
      res.status(429).json({ error: "The tutor has used up today's budget. It'll be back tomorrow; the Debugger and Inspect values still work." } satisfies TutorErrorBody);
      return;
    }
    next();
  };
}
