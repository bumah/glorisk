import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'src/index.html'),
        methodology: resolve(import.meta.dirname, 'src/methodology.html'),
        market: resolve(import.meta.dirname, 'src/market.html'),
        compare: resolve(import.meta.dirname, 'src/compare.html'),
      },
    },
  },
});
