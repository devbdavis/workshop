import { defineConfig, createLogger } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Vite attaches its own error handler to the raw upgrade socket and logs
// at the `error` level — which gets forwarded to the browser via HMR.
// EPIPE on a ws proxy socket is expected whenever a session closes while
// the client is still technically connected; suppress it here so the
// browser console stays clean.
const logger = createLogger();
const originalError = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (msg.includes('ws proxy socket error') && msg.includes('EPIPE')) {
    return;
  }
  originalError(msg, options);
};

export default defineConfig({
  customLogger: logger,
  plugins: [react(), tailwindcss()],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@foundation': path.resolve(__dirname, 'src/foundation'),
      '@domain': path.resolve(__dirname, 'src/domain'),
      '@infrastructure': path.resolve(__dirname, 'src/infrastructure'),
      '@application': path.resolve(__dirname, 'src/application'),
      '@server': path.resolve(__dirname, 'src/server'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Host left as-is: code-server rejects WebSockets whose Origin doesn't match Host.
      '^/code(/|$)': {
        target: 'http://localhost:3001',
        changeOrigin: false,
        ws: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        configure: (proxy) => {
          // Belt-and-suspenders: also suppress at the http-proxy event level.
          proxy.on('error', (err, _req, _socket) => {
            if ('code' in err && (err.code === 'EPIPE' || err.code === 'ECONNRESET')) {
              return;
            }
            console.error('[ws proxy] unexpected error:', err.message);
          });
        },
      },
    },
  },
});
