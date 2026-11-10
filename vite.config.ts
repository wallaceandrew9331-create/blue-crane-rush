/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// `base` is relative so the built site works from any path: GitHub Pages
// project sites live at /coffee-game/, Cloudflare Pages at the root.
export default defineConfig({
  base: './',
  server: { port: 5190, strictPort: true, host: true },
  preview: { port: 5191 },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['test/**/*.test.ts'] },
});
