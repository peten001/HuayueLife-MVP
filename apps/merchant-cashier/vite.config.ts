import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  build: {
    // Android terminals use the system WebView provider. Keep the production
    // bundle inside the oldest provider that the cashier officially supports.
    target: 'chrome83',
    cssTarget: 'chrome83',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5176,
    strictPort: true,
  },
  preview: {
    port: 5176,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
