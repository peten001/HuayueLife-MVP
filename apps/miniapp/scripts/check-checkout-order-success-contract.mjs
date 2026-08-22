import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const miniappRoot = path.resolve(scriptDirectory, '..');
const checkoutSource = readFileSync(
  path.join(miniappRoot, 'src/pages/checkout/index.vue'),
  'utf8',
);
const apiTypesSource = readFileSync(
  path.join(miniappRoot, 'src/types/api.ts'),
  'utf8',
);
const i18nSource = readFileSync(
  path.join(miniappRoot, 'src/i18n/index.ts'),
  'utf8',
);

assert.match(
  apiTypesSource,
  /export interface CreatedOrder\s*{[\s\S]*?status:\s*OrderStatus;/,
  'CreatedOrder.status must use the complete OrderStatus contract',
);
assert.doesNotMatch(
  apiTypesSource,
  /export interface CreatedOrder\s*{[\s\S]*?status:\s*'PENDING_ACCEPTANCE';/,
  'CreatedOrder.status must not be hard-coded to PENDING_ACCEPTANCE',
);

const showSuccessSource = checkoutSource.match(
  /function showSuccess\(order: CreatedOrder\)\s*{[\s\S]*?\n}/,
)?.[0];
assert.ok(showSuccessSource, 'checkout must keep the typed showSuccess handler');
assert.match(
  showSuccessSource,
  /order\.orderType === 'DINE_IN'[\s\S]*?t\('dineInSubmittedToTableBill'\)[\s\S]*?: t\('waitingMerchantAccept'\)/,
  'DINE_IN must use table-bill copy while PICKUP and DELIVERY keep merchant-accept copy',
);

const dineInCopy = {
  zh: '订单已提交至桌台账单',
  vi: 'Đơn hàng đã được thêm vào hóa đơn tại bàn',
  en: 'Your order has been added to the table bill',
};
for (const [locale, copy] of Object.entries(dineInCopy)) {
  assert.ok(
    i18nSource.includes(`dineInSubmittedToTableBill: '${copy}'`),
    `missing ${locale} DINE_IN table-bill success copy`,
  );
}
assert.equal(
  (i18nSource.match(/waitingMerchantAccept:/g) ?? []).length,
  3,
  'PICKUP and DELIVERY wait-for-merchant copy must remain in all three locales',
);
assert.equal(
  (i18nSource.match(/dineInSubmittedToTableBill:/g) ?? []).length,
  3,
  'DINE_IN table-bill copy must exist in all three locales',
);

console.log('CHECKOUT_ORDER_SUCCESS_CONTRACT=PASS');
