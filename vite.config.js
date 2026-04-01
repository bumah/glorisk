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
        browse: resolve(import.meta.dirname, 'src/browse.html'),
        methodology: resolve(import.meta.dirname, 'src/methodology.html'),
        market: resolve(import.meta.dirname, 'src/market.html'),
        compare: resolve(import.meta.dirname, 'src/compare.html'),
        stresstest: resolve(import.meta.dirname, 'src/stress-test.html'),
        watchlist: resolve(import.meta.dirname, 'src/watchlist.html'),
      },
    },
  },
});
