import { createServer } from '../../../merchant-admin/node_modules/vite/dist/node/index.js';
import vue from '../../../merchant-admin/node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('./', import.meta.url));
const server = await createServer({
  configFile: false, root, mode: 'arrival-preview',
  plugins: [vue(), {
    name: 'uniapp-arrival-source-preview', enforce: 'pre',
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url === '/__arrival-bootstrap') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(readFileSync('/tmp/huayue-arrival-preview.json', 'utf8')); return;
        }
        if (req.url?.startsWith('/static/')) req.url = '/@fs/' + fileURLToPath(new URL('../../src', import.meta.url)) + req.url;
        next();
      });
    },
    transform(code, id) {
      if (id.endsWith('.vue')) return code.replace(/<(\/?)(view|text|image|scroll-view|picker)(?=[\s>])/g,
        (_m, close, tag) => '<' + close + ({ view: 'PreviewView', text: 'PreviewText', image: 'PreviewImage', 'scroll-view': 'PreviewScroll', picker: 'PreviewPicker' }[tag]))
        .replace(/@tap/g, '@click');
      if (id.endsWith('.css') || id.includes('type=style')) return code.replace(/([\d.]+)rpx/g, 'calc($1 * var(--rpx))');
    },
  }],
  resolve: { alias: { '@': fileURLToPath(new URL('../../src/', import.meta.url)), '@dcloudio/uni-app': root + 'lifecycle.ts' }, dedupe: ['vue', 'pinia'] },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') }, publicDir: false,
  server: { host: '127.0.0.1', port: 34121, strictPort: true,
    proxy: { '/api/v1': { target: 'http://127.0.0.1:34120' } },
    fs: { allow: [fileURLToPath(new URL('../../../../', import.meta.url))] },
  },
});
await server.listen();
console.log('MiniApp arrival source preview: http://127.0.0.1:34121 (isolated local data only)');
