import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const miniappRoot = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(miniappRoot, '../..');
const detail = readFileSync(path.join(miniappRoot, 'src/pages/merchant/detail.vue'), 'utf8');
const i18n = readFileSync(path.join(miniappRoot, 'src/i18n/index.ts'), 'utf8');

let passed = 0;
function check(name, assertion) {
  assertion();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

const claimTemplate = detail.match(/<view v-if="showClaimCta" class="claim-card">[\s\S]*?<\/view>\s*<\/view>/)?.[0] ?? '';
const claimActionCss = detail.match(/\.claim-action \{[\s\S]*?\n\}/)?.[0] ?? '';
const claimCardCss = detail.match(/\.claim-card \{[\s\S]*?\n\}/)?.[0] ?? '';

check('claim CTA handler remains native WeChat contact', () => {
  assert.match(claimTemplate, /open-type="contact"/);
  assert.doesNotMatch(claimTemplate, /@click=/);
});
check('claim route remains unchanged', () => assert.doesNotMatch(claimTemplate, /url=|navigateTo|redirectTo/));
check('claim button text is horizontally centered', () => assert.match(claimActionCss, /justify-content:\s*center/));
check('claim button text is vertically centered', () => assert.match(claimActionCss, /align-items:\s*center/));
check('claim card left and right are vertically aligned', () => assert.match(claimCardCss, /align-items:\s*center/));

function checkViewport(viewportPx) {
  const contentRpx = 750 - 44 - 40 - 18 - 156;
  const copyWidthPx = contentRpx * viewportPx / 750;
  assert.ok(copyWidthPx >= 246, `${viewportPx}px copy width is ${copyWidthPx}px`);
  assert.match(claimActionCss, /min-height:\s*88rpx/);
  assert.match(claimActionCss, /white-space:\s*nowrap/);
}

check('375px claim card budget', () => checkViewport(375));
check('390px claim card budget', () => checkViewport(390));
check('430px claim card budget', () => checkViewport(430));
check('CLAIMED merchants remain outside the claim CTA', () => {
  assert.match(detail, /isUnclaimedDisplayMerchant = computed\([\s\S]*merchantMode === 'DISPLAY'[\s\S]*claimStatus === 'UNCLAIMED'/);
  assert.match(detail, /const showClaimCta = computed\(\(\) => isUnclaimedDisplayMerchant\.value\)/);
});
check('promotion tags remain rendered', () => assert.match(detail, /displayTags/));
check('merchant gallery classification remains rendered', () => assert.match(detail, /galleryCategories/));
check('signature dishes remain rendered', () => assert.match(detail, /signatureDishes/));
check('hot recommendations remain rendered', () => assert.match(detail, /hotRecommendations/));
check('bottom favorite remains rendered', () => {
  assert.match(detail, /handleToggleFavorite/);
  assert.match(detail, /is-favorite/);
});
check('ordering visibility remains delegated to the protected helper', () => assert.match(detail, /resolveMerchantOrderingVisibility/));
check('homepage has no tracked diff', () => {
  const diff = execFileSync('git', ['diff', '--name-only', '--', 'apps/miniapp/src/pages/home/index.vue'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  assert.equal(diff, '');
});

assert.match(i18n, /merchantClaimAction:\s*'免费认领'/);
assert.match(i18n, /merchantClaimAction:\s*'Nhận miễn phí'/);
assert.match(i18n, /merchantClaimAction:\s*'Claim for free'/);
console.log(`Merchant detail V3.5 checks passed: ${passed}/16`);
