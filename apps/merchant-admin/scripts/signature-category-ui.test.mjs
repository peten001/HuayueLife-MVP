import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [products, platformDetail, signatureSection] = await Promise.all([
  readFile(new URL('../src/pages/ProductsPage.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/PlatformMerchantDetailPage.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PlatformMerchantSignatureDishesSection.vue', import.meta.url), 'utf8'),
]);

assert.match(products, /isSignatureCategory\(row\)/);
assert.match(products, /signature-category-badge/);
assert.match(products, /v-if="!isSignatureCategory\(row\)"/);
assert.match(platformDetail, /uses-menu-signature-category/);
assert.match(signatureSection, /该商家的招牌菜由商家后台菜单中的招牌菜分类维护。/);
assert.match(signatureSection, /v-if="usesMenuSignatureCategory"/);

console.log('signature-category-ui: merchant and platform admin boundaries are present.');
