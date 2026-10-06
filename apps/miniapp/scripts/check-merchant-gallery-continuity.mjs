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

assert.equal(helper.galleryIndexAfterChange(2, 13, { current: 8, source: '' }), 2,
  'a delayed environment-tab animation must not undo a newer product-tab selection');
assert.equal(helper.galleryIndexAfterChange(2, 13, { current: 0, source: '' }), 2,
  'an old cover animation must not reset the selected product photo');
assert.equal(helper.galleryIndexAfterChange(2, 13, { current: 3, source: 'touch' }), 3,
  'a real swipe must still advance the selected photo');
assert.equal(helper.galleryIndexAfterChange(2, 13, { current: 3 }), 3,
  'legacy swipe adapters without source metadata remain supported');

const start = { pageX: 200, pageY: 400 };
assert.equal(helper.gallerySwipeDirection(start, { pageX: 120, pageY: 405 }), 1);
assert.equal(helper.gallerySwipeDirection(start, { pageX: 280, pageY: 395 }), -1);
assert.equal(helper.gallerySwipeDirection(start, { pageX: 204, pageY: 402 }), 0, 'tapping a category must not advance the photo');
assert.equal(helper.gallerySwipeDirection(start, { pageX: 180, pageY: 400 }), 0, 'small finger movement must remain a tap');
assert.equal(helper.gallerySwipeDirection(start, { pageX: 250, pageY: 470 }), 0, 'scrolling the page must not switch photos');
assert.equal(helper.gallerySwipeDirection(start, { pageX: 250, pageY: 440 }), 0, 'diagonal page gestures must not switch photos');
assert.equal(helper.gallerySwipeDirection(start, { pageX: NaN, pageY: 400 }), 0);
assert.equal(helper.galleryIndexAfterSwipe(5, media.length, 1), 0, 'the footer must wrap from the last image just like the photo swiper');
assert.equal(helper.galleryIndexAfterSwipe(0, media.length, -1), 5);
assert.equal(helper.galleryCategoryForIndex(media, helper.galleryIndexAfterSwipe(2, media.length, 1)), 'PRODUCT', 'footer swipes must keep the active category in sync');
assert.equal(helper.galleryIndexAfterSwipe(0, 1, 1), 0);
assert.equal(helper.galleryIndexAfterSwipe(0, 0, -1), 0);

assert.deepEqual(Array.from({ length: 13 }, (_, index) => index).filter(index => helper.shouldLoadGalleryImage(index, 0, 13)), [0, 1, 12], 'opening a gallery must mount only the current photo and its two neighbours');
assert.deepEqual(Array.from({ length: 13 }, (_, index) => index).filter(index => helper.shouldLoadGalleryImage(index, 5, 13)), [4, 5, 6]);
assert.deepEqual(Array.from({ length: 13 }, (_, index) => index).filter(index => helper.shouldLoadGalleryImage(index, 12, 13)), [0, 11, 12]);
assert.equal(helper.shouldLoadGalleryImage(0, 0, 0), false);
assert.equal(helper.shouldLoadGalleryImage(0, 0, 1), true);

const labels = { COVER: '封面', STORE: '门店外观', PRODUCT: '商品', ENVIRONMENT: '商家环境', SERVICE: '服务项目' };
const imageRecords = ['STORE', 'PRODUCT', 'ENVIRONMENT'].flatMap(imageType =>
  Array.from({ length: 5 }, (_, index) => ({ id: `${imageType}-${index}`, imageType, imageUrl: `${imageType}-${index + 1}`, sortOrder: index })),
);
imageRecords.push({ id: 'hidden', imageType: 'ENVIRONMENT', imageUrl: 'hidden', sortOrder: -1, isVisible: false });
const options = {
  restaurant: true,
  cover: 'cover',
  store: helper.galleryImageUrls(imageRecords, 'STORE'),
  products: helper.galleryImageUrls(imageRecords, 'PRODUCT'),
  environment: helper.galleryImageUrls(imageRecords, 'ENVIRONMENT'),
  services: ['service-1'],
  labels,
};
const restaurantGallery = helper.buildMerchantGalleryCategories(options);
assert.deepEqual(restaurantGallery.map(category => [category.key, category.urls.length]), [
  ['COVER', 1], ['STORE', 5], ['PRODUCT', 5], ['ENVIRONMENT', 5],
], 'all five uploaded photos in each category must remain available');
const restaurantMedia = helper.flattenGalleryMedia(restaurantGallery);
const environmentStart = helper.firstGalleryIndexForCategory(restaurantMedia, 'ENVIRONMENT');
assert.deepEqual(helper.galleryPhotoPosition(restaurantMedia, environmentStart + 3), { current: 4, total: 5 });
assert.deepEqual(helper.galleryPhotoPosition(restaurantMedia, environmentStart + 4), { current: 5, total: 5 });
assert.equal(restaurantMedia[environmentStart + 4].url, 'ENVIRONMENT-5');
assert.ok(!restaurantMedia.some(item => item.url === 'hidden'));
const retailGallery = helper.buildMerchantGalleryCategories({ ...options, restaurant: false });
assert.deepEqual(retailGallery.find(category => category.key === 'PRODUCT').urls, options.products,
  'retail and service templates must retain uploaded product photos');
assert.equal(retailGallery.find(category => category.key === 'ENVIRONMENT').urls.length, 10);
assert.equal(helper.flattenGalleryMedia(retailGallery).length, 17);
assert.deepEqual(helper.galleryPhotoPosition([], 0), { current: 0, total: 0 });
assert.deepEqual(helper.buildMerchantGalleryCategories({ ...options, cover: undefined, store: [], environment: [], services: [], restaurant: false }), [
  { key: 'PRODUCT', label: '商品', urls: options.products },
], 'a merchant with only product uploads must still have a gallery');

assert.doesNotMatch(detail, /flattenGalleryMedia\([^)]*MENU/);
assert.match(detail, /return buildMerchantGalleryCategories\(/);
assert.match(detail, /products: sortedGalleryUrls\('PRODUCT'\)/);
assert.match(detail, /galleryPhotoPosition\(flatGalleryMedia\.value, activeHeroIndex\.value\)/);
assert.match(detail, /const flatGalleryMedia = computed\(\(\) => flattenGalleryMedia\(galleryCategories\.value\)\)/);
assert.match(detail, /<swiper-item v-for="media in flatGalleryMedia" :key="media\.stableKey">/);
assert.match(detail, /activeGalleryCategory\.value = galleryCategoryForIndex\(flatGalleryMedia\.value, nextIndex\)/);
assert.match(detail, /activeHeroIndex\.value = categoryIndex/);
assert.doesNotMatch(detail, /activeGalleryCategory\.value === key\) return/);

for (const viewportWidth of [375, 390, 430]) {
  assert.ok((88 * viewportWidth) / 750 >= 44);
}

console.log('check-merchant-gallery-continuity: PASS');
