import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
    // Generate assets without hash for Go embed compatibility
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  // Base path is injected at runtime by Go server, use relative paths
  base: './',
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
