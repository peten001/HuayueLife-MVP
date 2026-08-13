import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const miniappRoot = path.resolve(currentDir, '..');
const detailPath = path.join(miniappRoot, 'src/pages/merchant/detail.vue');
const orderingPath = path.join(miniappRoot, 'src/utils/merchant-ordering-visibility.ts');
const favoritesPath = path.join(miniappRoot, 'src/utils/favorites.ts');
const i18nPath = path.join(miniappRoot, 'src/i18n/index.ts');

const detail = fs.readFileSync(detailPath, 'utf8');
const ordering = fs.readFileSync(orderingPath, 'utf8');
const favorites = fs.readFileSync(favoritesPath, 'utf8');
const i18n = fs.readFileSync(i18nPath, 'utf8');

function blockAfter(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const end = source.indexOf('\n});', start);
  assert.notEqual(end, -1, `unterminated ${marker}`);
  return source.slice(start, end + 4);
}

const displayHeroBlock = blockAfter(detail, 'const displayHeroImages = computed(() => {');
const claimedGalleryStart = detail.indexOf('const claimedGalleryCategories = computed<ClaimedGalleryCategory[]>(() => {');
const claimedGalleryEnd = detail.indexOf('const displayHeroImages = computed(() => {', claimedGalleryStart);
assert.notEqual(claimedGalleryStart, -1, 'missing claimed gallery categories');
assert.notEqual(claimedGalleryEnd, -1, 'unterminated claimed gallery categories');
const claimedGalleryBlock = detail.slice(claimedGalleryStart, claimedGalleryEnd);
const environmentBlock = blockAfter(detail, 'const environmentImages = computed(() => {');

assert.match(detail, /const visibleGalleryImages = computed\([\s\S]*item\.isVisible !== false/);
assert.ok(
  displayHeroBlock.indexOf('append(merchant.value?.coverUrl);')
    < displayHeroBlock.indexOf("(['STORE', 'MENU'] as const)"),
  'DISPLAY hero must retain cover before STORE and MENU media',
);
assert.match(displayHeroBlock, /\['STORE', 'MENU'\] as const/);
assert.doesNotMatch(displayHeroBlock, /ENVIRONMENT|PRODUCT/);
assert.match(claimedGalleryBlock, /key: 'COVER'[\s\S]*key: 'STORE'[\s\S]*key: 'PRODUCT'[\s\S]*key: 'ENVIRONMENT'/);
assert.match(claimedGalleryBlock, /sortedGalleryUrls\('STORE', 3\)/);
assert.match(claimedGalleryBlock, /sortedGalleryUrls\('PRODUCT', 6\)/);
assert.match(claimedGalleryBlock, /sortedGalleryUrls\('ENVIRONMENT', 3\)/);
assert.match(claimedGalleryBlock, /signatureDishes\.value\.forEach[\s\S]*hotRecommendations\.value\.forEach/);
assert.doesNotMatch(claimedGalleryBlock, /MENU/);
assert.match(environmentBlock, /item\.imageType === 'ENVIRONMENT'/);
assert.doesNotMatch(environmentBlock, /item\.imageType === 'PRODUCT'/);
assert.match(displayHeroBlock, /!urls\.includes\(resolved\)/);
assert.match(environmentBlock, /!heroUrls\.has\(resolved\).*?!urls\.includes\(resolved\)/s);

assert.match(
  detail,
  /merchantMode === 'MANAGED' && merchant\.value\?\.claimStatus === 'CLAIMED'/,
);
assert.match(
  detail,
  /merchantMode === 'DISPLAY' && merchant\.value\?\.claimStatus === 'UNCLAIMED'/,
);
assert.match(detail, /t\('merchantClaimed'\).*t\('merchantUnclaimed'\)/s);
assert.match(detail, /v-if="showClaimCta" class="claim-card"/);
assert.match(detail, /open-type="contact"/);
assert.doesNotMatch(detail, /merchantClaimSuccess|claimApplication|handleClaimContact/);

assert.match(detail, /const signatureDishes = computed\(\(\) => merchant\.value\?\.signatureDishes \?\? \[\]\)/);
assert.match(detail, /const hotRecommendations = computed\(\(\) => merchant\.value\?\.hotRecommendations \?\? \[\]\)/);
assert.match(detail, /v-if="signatureDishes\.length"/);
assert.match(detail, /v-if="hotRecommendations\.length"/);
assert.match(detail, /v-if="!isClaimedMerchant && environmentImages\.length"/);
assert.match(detail, /signatureDefaultLimit = computed\(\(\) => \(viewportWidth\.value < 390 \? 6 : 8\)\)/);
assert.match(detail, /hotDefaultLimit = computed\(\(\) => \(viewportWidth\.value < 390 \? 3 : 4\)\)/);
assert.match(detail, /v-for="dish in visibleSignatureDishes"/);
assert.match(detail, /v-for="product in visibleHotRecommendations"/);
assert.match(detail, /activeGalleryCategory\.value = key;[\s\S]*activeHeroIndex\.value = 0;/);
assert.match(detail, /merchant\.value\?\.detailDisplayTags/);
assert.doesNotMatch(detail, /displayTags = computed\([\s\S]{0,120}promotionTags/);

const heroShellStart = detail.indexOf('<view class="hero-shell">');
const heroShellEnd = detail.indexOf(
  '</view>\n\n      <scroll-view v-if="!isClaimedMerchant && heroImages.length > 1"',
  heroShellStart,
);
assert.notEqual(heroShellStart, -1, 'missing Hero shell');
assert.notEqual(heroShellEnd, -1, 'missing claimed Hero shell boundary');
const heroShellTemplate = detail.slice(heroShellStart, heroShellEnd);
assert.match(heroShellTemplate, /class="gallery-category-scroll"/);
assert.match(heroShellTemplate, /v-if="category\.key !== 'COVER'" class="gallery-category-count"/);
assert.match(detail, /\.gallery-category-scroll \{[\s\S]*position: absolute;[\s\S]*bottom: 0;[\s\S]*background: linear-gradient\(180deg,/);
assert.match(detail, /\.gallery-category-button\.is-active \{[\s\S]*background: rgb\(255 255 255 \/ 92%\);/);
assert.match(detail, /\.hero-count\.has-gallery-overlay \{[\s\S]*bottom: 116rpx;/);

assert.match(
  detail,
  /hasSignatureOverflow[\s\S]*:class="\['section-more-arrow', \{ 'is-expanded': signatureExpanded \}\]">›<\/text>/,
);
assert.match(
  detail,
  /hasHotOverflow[\s\S]*:class="\['section-more-arrow', \{ 'is-expanded': hotExpanded \}\]">›<\/text>/,
);
assert.match(detail, /\.section-heading \{[\s\S]*min-height: 88rpx;[\s\S]*align-items: center;/);
assert.match(detail, /\.section-more \{[\s\S]*justify-content: flex-end;[\s\S]*white-space: nowrap;/);
assert.match(detail, /\.section-more-arrow\.is-expanded \{[\s\S]*rotate\(-90deg\);/);

assert.match(detail, /heart: '\/static\/merchant-detail-icons\/heart-white\.png'/);
assert.match(detail, /heartActive: '\/static\/merchant-detail-icons\/heart-filled-warm\.png'/);
assert.match(detail, /favoriteState \? uiIcons\.heartActive : uiIcons\.heart/);
assert.match(detail, /favoriteState \? uiIcons\.heartActive : uiIcons\.heartGreen/);
assert.match(detail, /favoriteState\.value = isFavorite\(merchant\.value\.id\)/);
assert.match(detail, /const result = toggleFavorite\(merchant\.value\)/);
assert.match(favorites, /export function isFavorite/);
assert.match(favorites, /export function toggleFavorite/);
assert.match(detail, /\.meta-type \{[\s\S]*background: var\(--brand-deep\);/);

assert.match(ordering, /input\.merchantMode === 'MANAGED' && input\.claimStatus === 'CLAIMED'/);
assert.match(ordering, /input\.platformOrderingEnabled/);
assert.match(ordering, /pickupCtaVisible: pickupSupported && input\.supportedOrderTypes\.includes\('PICKUP'\)/);
assert.match(ordering, /deliveryCtaVisible: deliverySupported && input\.supportedOrderTypes\.includes\('DELIVERY'\)/);
assert.doesNotMatch(detail, /openMenu\('DINE_IN'\)|tableToken|qrCtaVisible/);
assert.match(detail, /class="primary pickup"/);
assert.match(detail, /\['primary', 'delivery', \{ 'is-solo': !canOpenPickup \}\]/);
assert.match(detail, /\.sticky-orders \.pickup \{[\s\S]*background: var\(--brand-soft\);/);
assert.match(detail, /\.sticky-orders \.delivery \{[\s\S]*background: var\(--brand-deep\);/);

for (const [locale, labels] of Object.entries({
  zh: ['已认领', '未认领', '这是您的商家？', '免费认领'],
  vi: ['Đã nhận', 'Chưa nhận', 'Đây là cửa hàng của bạn?', 'Nhận miễn phí'],
  en: ['Claimed', 'Unclaimed', 'Is this your business?', 'Claim for free'],
})) {
  for (const label of labels) {
    assert.ok(i18n.includes(label), `missing ${locale} claim copy: ${label}`);
  }
}

for (const match of detail.matchAll(/['"](\/static\/merchant-detail-icons\/[^'"]+)['"]/g)) {
  const assetPath = path.join(miniappRoot, 'src', match[1]);
  assert.ok(fs.existsSync(assetPath), `missing merchant-detail icon: ${match[1]}`);
}

console.log('check:merchant-detail-v3: source assertions passed.');
