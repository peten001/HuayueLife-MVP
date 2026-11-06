import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [products, platformDetail, signatureSection] = await Promise.all([
  readFile(new URL('../src/pages/ProductsPage.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/PlatformMerchantWorkspacePage.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/platform/PlatformMerchantItemsEditor.vue', import.meta.url), 'utf8'),
]);

assert.match(products, /isSignatureCategory\(row\)/);
assert.match(products, /signature-category-badge/);
assert.match(products, /v-if="!isSignatureCategory\(row\)"/);
assert.match(platformDetail, /menu-managed/);
assert.match(signatureSection, /招牌菜由商家菜单维护/);
assert.match(signatureSection, /v-if="menuManaged"/);

console.log('signature-category-ui: merchant and platform admin boundaries are present.');
