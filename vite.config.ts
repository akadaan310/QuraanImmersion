/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': srcDir },
  },
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
    chunkSizeWarningLimit: 1600,
  },
  test: {
    // `termux/tests` is a node:test suite for the CLI bridge and is run by
    // `npm run termux:test`. Vitest's default glob would collect it and then
    // fail, because a node:test file declares no vitest suite.
    exclude: ['node_modules/**', 'dist/**', 'termux/**'],
  },
});
