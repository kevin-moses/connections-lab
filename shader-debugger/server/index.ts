import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { OpenRouter } from '@openrouter/sdk';
import type { TutorErrorBody, TutorHealth } from '../shared/tutor';
import { DEFAULT_MODELS, OpenRouterModel } from './tutor/openrouter';
import { createMaterialLoader } from './tutor/material';
import { TutorError, type LanguageModel } from './tutor/provider';
import { StubModel } from './tutor/stub';
import { Tutor } from './tutor/tutor';
import { dailyCap, rateLimit } from './rateLimit';
import { parseTutorRequest } from './validate';

// Load .env from the project root (Node ≥ 21.7). A missing file is fine.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env */
}

/**
 * Production (Railway): listen on the platform's PORT on every interface,
 * serve the built app from dist/, and cap what the tutor can spend. In
 * development, Vite serves the app and this proxy stays on loopback.
 */
const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
const HOST = PROD ? '0.0.0.0' : '127.0.0.1';
const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PER_CLIENT_PER_MINUTE = Number(process.env.TUTOR_RATE_LIMIT ?? (PROD ? 20 : 60));
const PER_DAY = Number(process.env.TUTOR_DAILY_LIMIT ?? (PROD ? 300 : Infinity));

/** The model behind the tutor, and a one-line description of it for the log and /api/health. */
function pickModel(): { model: LanguageModel; label: string; reason?: string } {
  const stub = (reason: string) => ({ model: new StubModel(), label: `stub: ${reason}`, reason });
  if (process.env.TUTOR_PROVIDER === 'stub') return stub('TUTOR_PROVIDER=stub');
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return stub('No OPENROUTER_API_KEY in .env');
  const models = {
    fast: process.env.TUTOR_MODEL_FAST || DEFAULT_MODELS.fast,
    strong: process.env.TUTOR_MODEL_STRONG || DEFAULT_MODELS.strong,
  };
  const label = models.fast === models.strong ? models.strong : `fast ${models.fast}, strong ${models.strong}`;
  return { model: new OpenRouterModel(new OpenRouter({ apiKey }), models), label: `openrouter: ${label}` };
}

const { model, label, reason } = pickModel();
const tutor = new Tutor(model, createMaterialLoader());

const app = express();
app.disable('x-powered-by');
// Behind Railway's proxy, the client's address is in X-Forwarded-For (one hop): per-client limits need it.
if (PROD) app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  const health: TutorHealth = { ok: true, provider: model.name, live: model.live, reason };
  res.json(health);
});

app.post('/api/tutor', rateLimit({ max: PER_CLIENT_PER_MINUTE, windowMs: 60_000 }), dailyCap({ max: PER_DAY }), async (req, res) => {
  const parsed = parseTutorRequest(req.body);
  if (typeof parsed === 'string') {
    res.status(400).json({ error: parsed } satisfies TutorErrorBody);
    return;
  }
  // The line explainer drops requests when the cursor moves on: stop paying for those.
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  try {
    res.json(await tutor.complete(parsed, abort.signal));
  } catch (err) {
    if (abort.signal.aborted) return;
    if (err instanceof TutorError) {
      res.status(err.status).json({ error: err.message } satisfies TutorErrorBody);
    } else {
      console.error('[tutor]', err);
      res.status(500).json({ error: 'The tutor had a problem. Try again.' } satisfies TutorErrorBody);
    }
  }
});

if (PROD) {
  if (!existsSync(DIST)) throw new Error('dist/ is missing: run `npm run build` before `npm start`.');
  // Hashed file names: cache them for good. index.html must always be fresh.
  app.use('/assets', express.static(`${DIST}/assets`, { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(DIST, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
}

// In development, loopback only: the proxy spends your API key, so nothing
// else on the network may reach it. In production the limits above do that job.
app.listen(PORT, HOST, () => {
  const limits = `${PER_CLIENT_PER_MINUTE}/min per client${Number.isFinite(PER_DAY) ? `, ${PER_DAY}/day in all` : ''}`;
  console.log(`${PROD ? 'app + tutor' : 'tutor proxy'} on http://${HOST}:${PORT} (${label}; ${limits})`);
});
