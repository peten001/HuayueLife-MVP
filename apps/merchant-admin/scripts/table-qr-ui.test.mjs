import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/TablesPage.vue', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api/merchant.ts', import.meta.url), 'utf8');

assert.match(page, /v-if="qrVisible"[\s\S]*class="card table-qr-modal"/, 'table QR should retain a focused preview modal');
assert.match(page, /<img :src="qrImageUrl" :alt="t\('viewTableCode'\)" class="table-qr-image"/, 'preview should render only the QR image without table copy embedded around it');
assert.match(page, /class="table-solid-button" @click="downloadQrFile\(qrPreviewRow\)"/, 'download must remain the clear primary QR action');
assert.match(page, /key: 'rotate-qr'[\s\S]*labelKey: 'regenerateTableCode'/, 'QR reset must remain available as an explicit warning action');
assert.match(page, /rotateQrConfirm/, 'QR reset must retain its confirmation gate');
assert.doesNotMatch(page, /printQr|print-qr|printTableCode|window\.print|qrPrintPreview|table-qr-summary/, 'table QR management must not offer or generate print/poster layouts');
assert.doesNotMatch(page, /displayMerchantName\(\)[\s\S]{0,300}<div class="table-qr-image-wrap"/, 'QR preview must not add merchant or table artwork');
assert.match(api, /`\/merchant\/tables\/\$\{id\}\/qr-image`/, 'preview and download must keep using the existing QR image endpoint');
assert.match(api, /`\/merchant\/tables\/\$\{id\}\/rotate-qr`/, 'reset must keep using the existing rotate endpoint');
assert.match(api, /URL\.createObjectURL\(blob\)/, 'download must remain a real blob download');

assert.match(page, /\.table-qr-modal \{\s*width: min\(560px, 100%\);/, 'desktop preview should stay compact');
assert.match(page, /\.table-qr-image \{[\s\S]*width: min\(360px, 100%\);[\s\S]*max-width: 100%;/, 'QR should scale without horizontal overflow at desktop and phone widths');
assert.match(page, /@media \(max-width: 768px\)[\s\S]*\.table-qr-modal \{[\s\S]*width: 100%;[\s\S]*padding: 20px;/, '430, 390, and 375px widths should use the mobile bottom-sheet composition');
assert.match(page, /\.table-modal-actions > \*,[\s\S]*\.table-form-actions > \* \{\s*width: 100%;/, 'phone QR actions should remain clear with long translations');
assert.match(page, /\.table-mobile-actions \.table-action-button \{[\s\S]*min-height: 44px;/, 'phone table actions must meet the touch target floor');
assert.match(page, /\.table-modal-header > div \{\s*min-width: 0;/, 'long table names in adjacent modal flows must not force horizontal overflow');

console.log('table QR UI checks passed');
