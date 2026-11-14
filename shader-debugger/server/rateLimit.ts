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
