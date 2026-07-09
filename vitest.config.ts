import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
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
  test: {
    globals: false,
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['tests/global-setup.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**', '**/.direnv/**'],
  },
});
