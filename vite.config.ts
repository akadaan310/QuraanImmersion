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
  // Vitest shares the app's alias so the hypermath suite imports exactly what
  // the app imports — a divergent alias would test a different module graph.
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
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
});
