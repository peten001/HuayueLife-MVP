import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptsDir, '..');
const detail = readFileSync(path.join(appRoot, 'src/pages/PlatformMerchantDetailPage.vue'), 'utf8');
const layout = readFileSync(path.join(appRoot, 'src/layouts/PlatformLayout.vue'), 'utf8');
const platformApi = readFileSync(path.join(appRoot, 'src/api/platform.ts'), 'utf8');

let passed = 0;
function check(name, assertion) {
  assertion();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

const sectionKeys = [
  'profile', 'location', 'content', 'businessHours', 'images', 'signatureDishes',
  'visibility', 'hot', 'tags', 'display-tags', 'capabilities', 'account', 'danger',
];
const imageTypes = ['STORE', 'PRODUCT', 'ENVIRONMENT', 'MENU'];

check('all existing merchant sections remain present', () => {
  for (const key of sectionKeys) assert.match(detail, new RegExp(`id="merchant-section-${key}"`));
});
check('left navigation entries cover every merchant section', () => {
  for (const key of sectionKeys) assert.match(layout, new RegExp(`key: '${key}'`));
});
check('section headers share one visual treatment', () => {
  assert.match(detail, /\.editor-section-head \{[\s\S]*border-bottom:\s*1px solid #e7eee9/);
});
check('form controls share consistent dimensions', () => {
  assert.match(detail, /\.editor-form-grid input,[\s\S]*min-height:\s*37px/);
  assert.match(detail, /@media \(max-width: 760px\)[\s\S]*\.editor-form-grid input,[\s\S]*min-height:\s*44px/);
});
check('Logo upload remains present', () => assert.match(detail, /openImagePicker\('LOGO'\)/));
check('Cover upload remains present', () => assert.match(detail, /openImagePicker\('COVER'\)/));
for (const type of imageTypes) {
  check(`${type} upload remains present`, () => {
    assert.match(detail, new RegExp(`type: '${type}'`));
    assert.match(detail, /openImagePicker\(section\.type\)/);
  });
}
check('manual image title inputs are removed from the UI', () => {
  assert.doesNotMatch(detail, /v-model="image\.title(?:Zh|Vi|En)"/);
  assert.doesNotMatch(detail, /标题（中文）|标题（Tiếng Việt）|标题（English）/);
});
check('saving image display settings preserves historical titles', () => {
  const saveBlock = detail.match(/async function saveMerchantImage[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(saveBlock, /titleZh|titleVi|titleEn/);
  assert.match(saveBlock, /sortOrder/);
  assert.match(saveBlock, /isVisible/);
});
check('Cover preview uses a Hero-like ratio', () => {
  assert.match(detail, /image-primary-card--cover/);
  assert.match(detail, /\.image-primary-card--cover img,[\s\S]*aspect-ratio:\s*16 \/ 9/);
});
check('multi-image cards use one consistent ratio', () => {
  assert.match(detail, /\.merchant-gallery-card > img \{[\s\S]*aspect-ratio:\s*16 \/ 9/);
});
check('Replace remains present', () => {
  assert.match(detail, /openImageReplacement\(image\)/);
  assert.match(detail, /replacePlatformMerchantImage/);
});
check('Delete remains present', () => {
  assert.match(detail, /removeMerchantImage\(image\)/);
  assert.match(detail, /deletePlatformMerchantImage/);
});
check('visible controls remain present', () => assert.match(detail, /v-model="image\.isVisible"/));
check('sortOrder controls remain present', () => assert.match(detail, /v-model\.number="image\.sortOrder"/));
check('tag CRUD remains present', () => {
  for (const marker of ['openPromotionTagCreate', 'openPromotionTagEdit', 'removePromotionTag', 'submitPromotionTag']) {
    assert.match(detail, new RegExp(marker));
  }
});
check('capability UI and save path remain present', () => {
  assert.match(detail, /v-model="capabilityValues\[capability\.code\]"/);
  assert.match(detail, /@click="saveCapabilities"/);
});
check('dangerous actions remain present', () => {
  for (const marker of ['toggleClientVisibility', 'toggleMerchantStatus', 'resetPassword', 'deleteMerchant']) {
    assert.match(detail, new RegExp(marker));
  }
});
check('save actions remain present with explicit hierarchy', () => {
  assert.match(detail, /保存商家资料/);
  assert.match(detail, /保存基础资料/);
  assert.match(detail, /保存品牌与内容/);
  assert.match(detail, /保存营业时间/);
  assert.match(detail, /保存能力/);
});
check('no business profile field was removed', () => {
  for (const field of [
    'nameZh', 'nameVi', 'nameEn', 'businessTypeId', 'contactPhone', 'contactName',
    'province', 'addressZh', 'addressVi', 'addressEn', 'latitude', 'longitude',
    'openingHoursText', 'descriptionZh', 'descriptionVi', 'descriptionEn',
  ]) assert.match(detail, new RegExp(`profileForm\\.${field}`));
});
check('upload APIs require only the selected file', () => {
  for (const fn of ['replacePlatformMerchantImage', 'uploadPlatformMerchantContentImage', 'replacePlatformMerchantPrimaryImage']) {
    const block = platformApi.match(new RegExp(`export async function ${fn}[\\s\\S]*?\\n}`))?.[0] ?? '';
    assert.match(block, /formData\.append\('file', file\)/);
    assert.doesNotMatch(block, /formData\.append\(['"](?:name|title)/);
  }
});
check('image classification stays explicit and never auto-fills', () => {
  assert.deepEqual(imageTypes.filter((type) => detail.includes(`type: '${type}'`)), imageTypes);
  assert.doesNotMatch(detail, /autoFill|guessImageType|signature.*fallback|hot.*fallback/i);
});

console.log(`Platform merchant detail V3.5 checks passed: ${passed}/25`);
