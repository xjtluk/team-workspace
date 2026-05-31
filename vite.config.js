import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3210',
      '/ws': {
        target: 'ws://localhost:3210',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
