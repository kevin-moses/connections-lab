import { fileURLToPath } from 'node:url';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { TutorErrorBody, TutorHealth } from '../shared/tutor';
import { ClaudeModel, DEFAULT_MODELS } from './tutor/claude';
import { createMaterialLoader } from './tutor/material';
import { TutorError, type LanguageModel } from './tutor/provider';
import { StubModel } from './tutor/stub';
import { Tutor } from './tutor/tutor';
import { rateLimit } from './rateLimit';
import { parseTutorRequest } from './validate';

// Load .env from the project root (Node ≥ 21.7). A missing file is fine.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env */
}

const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = '127.0.0.1';

/** The model behind the tutor, and a one-line description of it for the log and /api/health. */
function pickModel(): { model: LanguageModel; label: string; reason?: string } {
  const stub = (reason: string) => ({ model: new StubModel(), label: `stub: ${reason}`, reason });
  if (process.env.TUTOR_PROVIDER === 'stub') return stub('TUTOR_PROVIDER=stub');
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return stub('No ANTHROPIC_API_KEY in .env');
  const models = {
    fast: process.env.TUTOR_MODEL_FAST || DEFAULT_MODELS.fast,
    strong: process.env.TUTOR_MODEL_STRONG || DEFAULT_MODELS.strong,
  };
  return { model: new ClaudeModel(new Anthropic(), models), label: `claude: fast ${models.fast}, strong ${models.strong}` };
}

const { model, label, reason } = pickModel();
const tutor = new Tutor(model, createMaterialLoader());

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  const health: TutorHealth = { ok: true, provider: model.name, live: model.live, reason };
  res.json(health);
});

app.post('/api/tutor', rateLimit({ max: Number(process.env.TUTOR_RATE_LIMIT ?? 60), windowMs: 60_000 }), async (req, res) => {
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

// Loopback only: the proxy spends your API key, so nothing else on the network may reach it.
app.listen(PORT, HOST, () => {
  console.log(`tutor proxy on http://${HOST}:${PORT} (${label})`);
});
