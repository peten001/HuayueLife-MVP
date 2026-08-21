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
  for (const key of ['profile', 'businessHours', 'images', 'tags', 'capabilities', 'account']) {
    assert.match(layout, new RegExp(`key: '${key}'`));
  }
  assert.doesNotMatch(layout, /key: 'danger'/);
});
check('section headers share one visual treatment', () => {
  assert.match(detail, /\.editor-section-head \{[\s\S]*border-bottom:\s*1px solid #edf2ee/);
});
check('form controls share consistent dimensions', () => {
  assert.match(detail, /\.editor-form-grid input,[\s\S]*height:\s*36px/);
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
  const saveBlock = detail.match(/async function saveAllChanges[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(saveBlock, /titleZh|titleVi|titleEn/);
  assert.match(saveBlock, /sortOrder/);
  assert.match(saveBlock, /isVisible/);
});
check('Cover preview uses a fixed hero-like ratio', () => {
  assert.match(detail, /gallery-primary-media--cover/);
  assert.match(detail, /\.gallery-primary-media--cover \{[\s\S]*width:\s*128px/);
});
check('multi-image thumbs use one consistent ratio', () => {
  assert.match(detail, /\.gallery-thumb-media img \{[\s\S]*height:\s*84px/);
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
  assert.match(detail, /@click="saveAllChanges"/);
});
check('dangerous actions remain present', () => {
  for (const marker of ['toggleClientVisibility', 'toggleMerchantStatus', 'resetPassword', 'deleteMerchant']) {
    assert.match(detail, new RegExp(marker));
  }
});
check('page uses one unified save action', () => {
  assert.match(detail, /保存全部修改/);
  assert.match(detail, /async function saveAllChanges/);
  assert.doesNotMatch(detail, /@click="save(?:Profile|BusinessHours|Tags|Capabilities)"/);
  assert.doesNotMatch(detail, />保存(?:商家资料|营业时间|标签配置|能力)</);
});
check('business hours reuse weekly intervals with a two-segment limit', () => {
  assert.match(detail, /MAX_BUSINESS_HOURS_INTERVALS = 2/);
  assert.match(detail, /businessHoursSchedule/);
  assert.match(detail, /营业时段不能重叠，包括相邻星期的跨天时段/);
  assert.match(detail, /Asia\/Ho_Chi_Minh（UTC\+7）/);
});
check('cuisine and scene limits are four', () => {
  assert.match(detail, /DETAIL_TAG_LIMIT = 4/);
  assert.match(detail, /最多显示 4 个菜系、4 个场景/);
  assert.doesNotMatch(detail, /前台最多 2/);
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

console.log(`Platform merchant detail V3.5 checks passed: ${passed}/27`);
