import { defineConfig } from 'vite';

const apiPort = Number(process.env.API_PORT ?? 3001);

export default defineConfig({
  server: {
    port: 5173,
    // 127.0.0.1, not localhost: the proxy listens on IPv4 loopback only.
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
  build: {
    rolldownOptions: {
      output: {
        // Libraries change far less often than app code: separate chunks
        // cache independently and keep each one under the size warning.
        codeSplitting: {
          groups: [
            { name: 'codemirror', test: /node_modules[\\/](@codemirror|@lezer|codemirror|style-mod|w3c-keyname|crelt)/ },
            { name: 'glsl-parser', test: /node_modules[\\/]@shaderfrog/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Lesson tests render every check image on the CPU interpreter, which is slow for the bigger shaders.
    testTimeout: 20_000,
  },
} as any);
