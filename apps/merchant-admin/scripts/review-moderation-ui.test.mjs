import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [page, routes, layout, api] = await Promise.all([
  readFile(new URL('../src/pages/PlatformReviewsPage.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/router/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/layouts/PlatformLayout.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/api/platform.ts', import.meta.url), 'utf8'),
]);

assert.match(routes, /path: 'reviews',[\s\S]*PlatformReviewsPage/);
assert.match(layout, /\/platform\/reviews'[\s\S]*评价审核/);
assert.match(api, /getPlatformReviews/);
assert.match(api, /moderatePlatformReview/);
assert.match(page, /风险与异常/);
assert.match(page, /内容安全记录/);
assert.match(page, /通过并公开/);
assert.match(page, /隐藏评价/);
assert.match(page, /恢复公开/);
assert.match(page, /prefers-reduced-motion/);

console.log('Platform review moderation UI contract PASS');
