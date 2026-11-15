import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { dailyCap, rateLimit } from '../server/rateLimit';

function call(limit: ReturnType<typeof rateLimit>, ip = '1.2.3.4') {
  const res = { statusCode: 200, headers: {} as Record<string, string>, body: null as unknown };
  const r = {
    setHeader: (k: string, v: string) => (res.headers[k] = v),
    status: (c: number) => ((res.statusCode = c), r),
    json: (b: unknown) => (res.body = b),
  };
  const next = vi.fn();
  limit({ ip } as Request, r as unknown as Response, next);
  return { ...res, passed: next.mock.calls.length === 1 };
}

describe('rateLimit', () => {
  it('lets max requests through per window, per IP, then answers 429', () => {
    vi.useFakeTimers();
    const limit = rateLimit({ max: 2, windowMs: 60_000 });
    expect(call(limit).passed).toBe(true);
    expect(call(limit).passed).toBe(true);
    const third = call(limit);
    expect(third.passed).toBe(false);
    expect(third.statusCode).toBe(429);
    expect(third.headers['Retry-After']).toBe('60');
    expect(call(limit, '5.6.7.8').passed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(call(limit).passed).toBe(true);
    vi.useRealTimers();
  });
});

describe('dailyCap', () => {
  it('counts every client together, then pauses until the next UTC day', () => {
    let t = Date.parse('2026-11-13T23:59:00Z');
    const cap = dailyCap({ max: 2, now: () => t });
    expect(call(cap, 'a').passed).toBe(true);
    expect(call(cap, 'b').passed).toBe(true);
    const third = call(cap, 'c');
    expect(third.passed).toBe(false);
    expect(third.statusCode).toBe(429);
    expect(third.headers['Retry-After']).toBe('60');
    expect(JSON.stringify(third.body)).toContain("today's budget");
    t = Date.parse('2026-11-14T00:00:01Z');
    expect(call(cap, 'c').passed).toBe(true);
  });
});
