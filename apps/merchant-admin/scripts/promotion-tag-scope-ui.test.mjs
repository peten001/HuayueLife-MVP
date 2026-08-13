import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dictionary = fs.readFileSync(path.join(root, 'src/pages/PlatformPromotionTagsPage.vue'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'src/pages/PlatformMerchantDetailPage.vue'), 'utf8');
const list = fs.readFileSync(path.join(root, 'src/pages/PlatformMerchantsPage.vue'), 'utf8');

assert.match(dictionary, /scope: 'OPERATIONAL'/);
assert.match(dictionary, /value: 'CUISINE'/);
assert.match(dictionary, /value: 'SCENE'/);
assert.match(dictionary, /标签字典管理/);

assert.match(detail, /tag\.scope === 'OPERATIONAL'/);
assert.match(detail, /tag\.scope === 'CUISINE'/);
assert.match(detail, /tag\.scope === 'SCENE'/);
assert.match(detail, /平台运营标签/);
assert.match(detail, /详情页展示标签/);
assert.match(detail, /用于平台运营\/首页逻辑，不直接显示在商家详情页/);
assert.match(detail, /updatePlatformMerchantTags\(merchantId\.value, \[\.\.\.selectedTagIds\.value\]\)/);
assert.match(list, /item\.enabled && item\.scope === 'OPERATIONAL'/);

console.log('promotion-tag-scope-ui: source assertions passed.');
