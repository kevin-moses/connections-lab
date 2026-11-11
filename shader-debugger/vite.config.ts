import { defineConfig } from 'vite';

const apiPort = Number(process.env.API_PORT ?? 3001);

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
} as any);
