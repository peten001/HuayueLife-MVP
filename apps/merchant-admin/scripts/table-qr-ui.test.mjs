import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/TablesPage.vue', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api/merchant.ts', import.meta.url), 'utf8');
const i18n = await readFile(new URL('../src/i18n/index.ts', import.meta.url), 'utf8');
const dialog = await readFile(new URL('../src/components/MerchantDialog.vue', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/merchant-pages.css', import.meta.url), 'utf8');
const shellStyles = await readFile(new URL('../src/styles/merchant-workbench.css', import.meta.url), 'utf8');

assert.match(page, /<MerchantDialog :open="qrVisible" :title="t\('viewTableCode'\)" @close="closeQrModal"/, 'table QR should use the shared focus-managed preview dialog');
assert.match(page, /<img :src="qrImageUrl" :alt="t\('viewTableCode'\)" class="table-qr-image"/, 'preview should render only the QR image without table copy embedded around it');
assert.match(page, /<button type="button" @click="downloadQrFile\(qrPreviewRow\)"/, 'download must remain the clear primary QR action');
assert.match(page, /key: 'rotate-qr'[\s\S]*labelKey: 'regenerateTableCode'/, 'QR reset must remain available as an explicit warning action');
assert.match(page, /rotateQrConfirm/, 'QR reset must retain its confirmation gate');
assert.match(i18n, /tablesDescription: '桌台使用普通二维码，换码后旧码立即失效'/, 'Chinese table copy should identify the standard QR artifact');
assert.match(i18n, /tablesDescription: 'Mỗi bàn sử dụng mã QR thông thường;/, 'Vietnamese table copy should identify the standard QR artifact');
assert.match(i18n, /tablesDescription: 'Tables use standard QR codes;/, 'English table copy should identify the standard QR artifact');
assert.match(i18n, /rotateQrConfirm: '为 \{tableNo\} 生成新的普通二维码？旧码将立即失效。'/, 'reset confirmation should describe the standard QR contract');
assert.doesNotMatch(page, /printQr|print-qr|printTableCode|window\.print|qrPrintPreview|table-qr-summary/, 'table QR management must not offer or generate print/poster layouts');
assert.doesNotMatch(page, /displayMerchantName\(\)[\s\S]{0,300}<div class="table-qr-image-wrap"/, 'QR preview must not add merchant or table artwork');
assert.match(api, /`\/merchant\/tables\/\$\{id\}\/qr-image`/, 'preview and download must keep using the existing QR image endpoint');
assert.match(api, /`\/merchant\/tables\/\$\{id\}\/rotate-qr`/, 'reset must keep using the existing rotate endpoint');
assert.match(api, /URL\.createObjectURL\(blob\)/, 'download must remain a real blob download');

assert.match(dialog, /width:min\(560px,calc\(100% - 40px\)\)/, 'desktop preview should stay compact');
assert.match(page, /\.table-qr-image\{[\s\S]*width:min\(360px,100%\);[\s\S]*max-width:100%;/, 'QR should scale without horizontal overflow at desktop and phone widths');
assert.match(dialog, /@media\(max-width:768px\)\{\.m-dialog\{width:100%[\s\S]*env\(safe-area-inset-bottom\)/, 'phone preview should use a safe-area bottom sheet');
assert.match(styles, /\.mx-floor-table footer button \{[^}]*flex: 1;/, 'table actions must share the available row width');
assert.match(shellStyles, /\.m-main--management button \{ min-height: 44px; \}/, 'table actions must meet the mobile touch target floor');
assert.doesNotMatch(page, /applyBodyScrollLock|document\.body\.style\.overflow/, 'shared dialogs must be the only scroll-lock owner');

console.log('table QR UI checks passed');
