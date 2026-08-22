import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const miniappRoot = path.resolve(import.meta.dirname, '..');
const helperPath = path.join(miniappRoot, 'src/pages/merchant/merchant-gallery-state.ts');
const detailPath = path.join(miniappRoot, 'src/pages/merchant/detail.vue');
const helperSource = await readFile(helperPath, 'utf8');
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: helperPath,
}).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(helperJs).toString('base64')}`);
const detail = await readFile(detailPath, 'utf8');

const categories = [
  { key: 'COVER', label: '封面', urls: ['cover'] },
  { key: 'STORE', label: '门店', urls: ['store-1', 'store-2'] },
  { key: 'PRODUCT', label: '菜品', urls: ['product-1', 'product-2'] },
  { key: 'ENVIRONMENT', label: '环境', urls: ['environment-1'] },
];
const media = helper.flattenGalleryMedia(categories);

assert.deepEqual(media.map((item) => item.url), [
  'cover',
  'store-1',
  'store-2',
  'product-1',
  'product-2',
  'environment-1',
]);
assert.deepEqual(media.map((item) => item.category), [
  'COVER',
  'STORE',
  'STORE',
  'PRODUCT',
  'PRODUCT',
  'ENVIRONMENT',
]);
assert.deepEqual(media.map((item) => item.globalIndex), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(media.map((item) => item.categoryLocalIndex), [0, 0, 1, 0, 1, 0]);
assert.equal(helper.galleryCategoryForIndex(media, 1), 'STORE');
assert.equal(helper.galleryCategoryForIndex(media, 3), 'PRODUCT');
assert.equal(helper.galleryCategoryForIndex(media, 5), 'ENVIRONMENT');
assert.equal(helper.firstGalleryIndexForCategory(media, 'STORE'), 1);
assert.equal(helper.firstGalleryIndexForCategory(media, 'PRODUCT'), 3);
assert.equal(helper.firstGalleryIndexForCategory(media, 'ENVIRONMENT'), 5);

const withoutCover = helper.flattenGalleryMedia(categories.slice(1));
assert.equal(helper.galleryCategoryForIndex(withoutCover, 0), 'STORE');
const productOnly = helper.flattenGalleryMedia([categories[2]]);
assert.deepEqual(productOnly.map((item) => item.category), ['PRODUCT', 'PRODUCT']);

const reordered = helper.flattenGalleryMedia([
  { key: 'COVER', label: '封面', urls: ['cover'] },
  { key: 'STORE', label: '门店', urls: ['store-2', 'store-1'] },
  categories[2],
  categories[3],
]);
assert.equal(helper.reconcileGalleryIndex(media, reordered, 2), 1);
const currentRemoved = helper.flattenGalleryMedia([
  categories[0],
  { key: 'STORE', label: '门店', urls: ['store-new'] },
  categories[2],
]);
assert.equal(helper.reconcileGalleryIndex(media, currentRemoved, 2), 1);

assert.doesNotMatch(detail, /flattenGalleryMedia\([^)]*MENU/);
assert.match(detail, /const flatGalleryMedia = computed\(\(\) => flattenGalleryMedia\(galleryCategories\.value\)\)/);
assert.match(detail, /<swiper-item v-for="media in flatGalleryMedia" :key="media\.stableKey">/);
assert.match(detail, /activeGalleryCategory\.value = galleryCategoryForIndex\(flatGalleryMedia\.value, nextIndex\)/);
assert.match(detail, /activeHeroIndex\.value = categoryIndex/);
assert.doesNotMatch(detail, /activeGalleryCategory\.value === key\) return/);

for (const viewportWidth of [375, 390, 430]) {
  assert.ok((88 * viewportWidth) / 750 >= 44);
}

console.log('check-merchant-gallery-continuity: PASS');
