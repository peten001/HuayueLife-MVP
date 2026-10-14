import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const kds = (process.env.VITE_TERMINAL_MODE || env.VITE_TERMINAL_MODE) === 'kds';
  return {
  plugins: [vue(), {
    name: 'kds-page-metadata',
    transformIndexHtml(html) {
      if (!kds) return html;
      return html.replace(/YunQiao Cashier/g, 'YunQiao KDS')
        .replace('正在打开 Web 收银台', '正在打开 YunQiao KDS')
        .replace('<img src="/yunqiao-cashier-splash.png" alt="" />', '<img src="/yunqiao-cashier-mark.png" alt="" /><strong class="kds-boot-name">YunQiao KDS</strong>')
        .replace(/terminal-bootstrap\.(css|js)\?v=20260919-push-splash/g, 'terminal-bootstrap.$1?v=20261014-kds-kitchen')
        .replace('href="/manifest.webmanifest"', 'href="/kds.webmanifest"')
        .replace('<html lang=', '<html data-terminal-kind="kds" lang=');
    },
  }],
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
  };
});
