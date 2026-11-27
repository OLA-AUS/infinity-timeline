// Build settings for Vite (the dev server and bundler).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Only the one environment variable we read; saves depending on @types/node.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  // GitHub Pages serves a project site from https://<owner>.github.io/<repo>/, so every asset
  // URL needs that prefix. The deploy workflow sets BASE_PATH=/<repo>/; locally it's just "/".
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
});
