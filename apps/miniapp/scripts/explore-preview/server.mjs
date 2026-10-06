import { createServer } from '../../../merchant-admin/node_modules/vite/dist/node/index.js';
import vue from '../../../merchant-admin/node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const server = await createServer({
  configFile: false, root, mode: 'explore-preview',
  plugins: [vue(), {
    name: 'preview-rpx', enforce: 'pre',
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/__production/') && !['GET', 'HEAD'].includes(req.method)) {
          res.statusCode = 405;
          res.end('Production preview is read-only');
          return;
        }
        if (req.url?.startsWith('/static/')) req.url = '/@fs/' + fileURLToPath(new URL('../../src', import.meta.url)) + req.url;
        next();
      });
    },
    transform(code, id) {
      if (id.endsWith('.vue')) return code.replace(/<(\/?)(view|text|image|scroll-view|swiper-item|swiper)(?=[\s>])/g, (_m, close, tag) => '<' + close + ({view:'PreviewView',text:'PreviewText',image:'PreviewImage','scroll-view':'PreviewScroll','swiper-item':'PreviewSwiperItem',swiper:'PreviewSwiper'}[tag])).replace(/@tap/g, '@click').replace(/@confirm/g, '@keyup.enter');
      if (id.endsWith('.css') || id.includes('type=style')) return code.replace(/([\d.]+)rpx/g, 'calc($1 * var(--rpx))').replace(/(?<=\s)image(?=[\s,{.:])/g, 'img');
    },
  }],
  resolve: { alias: { '@': fileURLToPath(new URL('../../src/', import.meta.url)), '@dcloudio/uni-app': root + 'lifecycle.ts' }, dedupe: ['vue', 'pinia'] },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/__fixture/api/v1') }, publicDir: false,
  server: {
    host: '127.0.0.1', port: 4200, strictPort: true,
    proxy: {
      '/__production': { target: 'https://api.huayueyouxuan.com', changeOrigin: true, rewrite: path => path.replace(/^\/__production/, '') },
      '/__local': { target: 'http://127.0.0.1:4102', rewrite: path => path.replace(/^\/__local/, '') },
    },
    fs: { allow: [fileURLToPath(new URL('../../../../', import.meta.url))] },
  },
});
await server.listen(); console.log('MiniApp source preview (production public data, read-only): http://localhost:4200/?page=home&width=390');
