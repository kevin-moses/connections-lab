import express from 'express';
import type { TutorHealth, TutorKind, TutorRequest } from '../shared/tutor';
import type { TutorProvider } from './tutor/provider';
import { StubProvider } from './tutor/stub';

const PORT = Number(process.env.API_PORT ?? 3001);
const KINDS: readonly TutorKind[] = ['line', 'error', 'hint'];

const provider: TutorProvider = new StubProvider();

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  const health: TutorHealth = { ok: true, provider: provider.name, live: provider.live };
  res.json(health);
});

app.post('/api/tutor', async (req, res) => {
  const body = req.body as Partial<TutorRequest> | undefined;
  if (!body || !KINDS.includes(body.kind as TutorKind) || typeof body.context?.code !== 'string') {
    res.status(400).json({ error: 'Expected { kind: "line" | "error" | "hint", context: { code } }' });
    return;
  }
  try {
    res.json(await provider.complete(body as TutorRequest));
  } catch (err) {
    console.error('[tutor]', err);
    res.status(502).json({ error: 'Tutor provider failed' });
  }
});

app.listen(PORT, () => {
  console.log(`tutor proxy on http://localhost:${PORT} (provider: ${provider.name})`);
});
