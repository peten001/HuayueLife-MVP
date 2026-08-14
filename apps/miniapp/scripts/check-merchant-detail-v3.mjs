import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const miniappRoot = path.resolve(currentDir, '..');
const detailPath = path.join(miniappRoot, 'src/pages/merchant/detail.vue');
const orderingPath = path.join(miniappRoot, 'src/utils/merchant-ordering-visibility.ts');
const favoritesPath = path.join(miniappRoot, 'src/utils/favorites.ts');
const favoriteGatePath = path.join(miniappRoot, 'src/utils/merchant-favorite-gate.ts');
const i18nPath = path.join(miniappRoot, 'src/i18n/index.ts');

const detail = fs.readFileSync(detailPath, 'utf8');
const ordering = fs.readFileSync(orderingPath, 'utf8');
const favorites = fs.readFileSync(favoritesPath, 'utf8');
const favoriteGate = fs.readFileSync(favoriteGatePath, 'utf8');
const i18n = fs.readFileSync(i18nPath, 'utf8');

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

const galleryBlock = sliceBetween(
  detail,
  'const galleryCategories = computed<GalleryCategory[]>(() => {',
  'const heroImages = computed(() => {',
);
const displayTagsBlock = sliceBetween(
  detail,
  'const displayTags = computed(() => {',
  'const isClaimedMerchant = computed(',
);

assert.match(detail, /const visibleGalleryImages = computed\([\s\S]*item\.isVisible !== false/);
assert.match(galleryBlock, /key: 'COVER'[\s\S]*key: 'STORE'[\s\S]*key: 'PRODUCT'[\s\S]*key: 'ENVIRONMENT'/);
assert.match(galleryBlock, /resolveMediaUrl\(merchant\.value\?\.coverUrl\)/);
assert.match(galleryBlock, /sortedGalleryUrls\('STORE', 3\)/);
assert.match(galleryBlock, /sortedGalleryUrls\('PRODUCT', 6\)/);
assert.match(galleryBlock, /sortedGalleryUrls\('ENVIRONMENT', 3\)/);
assert.doesNotMatch(galleryBlock, /signatureDishes|hotRecommendations|MENU/);
assert.doesNotMatch(galleryBlock, /isClaimedMerchant|isUnclaimedDisplayMerchant/);
assert.match(galleryBlock, /categories\.filter\(\(category\) => category\.urls\.length > 0\)/);
assert.doesNotMatch(galleryBlock, /urls\.length\s*(?:<|>=)\s*[136]/);
assert.match(detail, /\.filter\(\(url, index, urls\) => urls\.indexOf\(url\) === index\)[\s\S]*\.slice\(0, limit\)/);
assert.doesNotMatch(detail, /displayHeroImages|environmentImages|previewEnvironment/);
assert.doesNotMatch(detail, /class="thumbnail-scroll"/);

assert.match(displayTagsBlock, /merchant\.value\?\.detailDisplayTags \?\? \[\]/);
assert.match(displayTagsBlock, /merchant\.value\?\.promotionTags \?\? \[\]/);
assert.match(displayTagsBlock, /item\.scope === undefined \|\| item\.scope === 'OPERATIONAL'/);
assert.match(displayTagsBlock, /detailTagIds\.has\(item\.id\)/);
assert.match(displayTagsBlock, /seenLabels/);
assert.match(displayTagsBlock, /displayBusinessType\.value\.trim\(\)\.toLocaleLowerCase\(\)/);
assert.doesNotMatch(detail, /湘菜|适合聚餐|首页推荐|编辑精选|附近热门/);

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
assert.doesNotMatch(detail, /class="content-section environment-section"/);
assert.match(detail, /signatureDefaultLimit = computed\(\(\) => \(viewportWidth\.value < 390 \? 6 : 8\)\)/);
assert.match(detail, /hotDefaultLimit = computed\(\(\) => \(viewportWidth\.value < 390 \? 3 : 4\)\)/);
assert.match(detail, /v-for="dish in visibleSignatureDishes"/);
assert.match(detail, /v-for="product in visibleHotRecommendations"/);
assert.match(detail, /activeGalleryCategory\.value = key;[\s\S]*activeHeroIndex\.value = 0;/);
assert.match(detail, /merchant\.value\?\.detailDisplayTags/);
assert.match(detail, /merchant\.value\?\.promotionTags/);

const heroShellStart = detail.indexOf('<view class="hero-shell">');
const heroShellEnd = detail.indexOf('<view class="merchant-overview">', heroShellStart);
assert.notEqual(heroShellStart, -1, 'missing Hero shell');
assert.notEqual(heroShellEnd, -1, 'missing Hero shell boundary');
const heroShellTemplate = detail.slice(heroShellStart, heroShellEnd);
assert.match(heroShellTemplate, /class="gallery-category-scroll"/);
assert.match(heroShellTemplate, /v-if="galleryCategories\.length"/);
assert.match(heroShellTemplate, /v-for="category in galleryCategories"/);
assert.match(heroShellTemplate, /role="tablist"/);
assert.match(heroShellTemplate, /role="tab"/);
assert.match(heroShellTemplate, /:aria-selected="activeGalleryCategory === category\.key"/);
assert.match(heroShellTemplate, /class="gallery-category-active-marker"/);
assert.match(heroShellTemplate, /class="gallery-category-label">\{\{ category\.label \}\}/);
assert.doesNotMatch(heroShellTemplate, /hero-count|gallery-category-count|heroImages\.length \}\}/);
assert.doesNotMatch(heroShellTemplate, /class="hero-controls"/);
assert.doesNotMatch(heroShellTemplate, /class="hero-button/);
assert.doesNotMatch(heroShellTemplate, /open-type="share"/);
assert.match(detail, /\.gallery-category-scroll \{[\s\S]*position: absolute;[\s\S]*bottom: 0;[\s\S]*background: linear-gradient\(180deg,/);
assert.match(detail, /\.gallery-category-scroll \{[\s\S]*padding: 20rpx 12rpx 1rpx;/);
assert.match(
  detail,
  /\.gallery-category-button \{[\s\S]*min-height: 88rpx;[\s\S]*border: 1rpx solid transparent;[\s\S]*outline: none;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
);
assert.match(detail, /\.gallery-category-button\.is-active \{[\s\S]*border-color: transparent;[\s\S]*background: transparent;/);
assert.match(detail, /\.gallery-category-button\.is-active \.gallery-category-label \{[\s\S]*padding: 4rpx 14rpx;[\s\S]*background: rgb\(18 39 27 \/ 42%\);[\s\S]*transform: translateY\(2rpx\);/);
assert.match(
  heroShellTemplate,
  /:class="\['gallery-category-button', \{ 'is-active': activeGalleryCategory === category\.key \}\]"/,
);
assert.doesNotMatch(detail, /\.gallery-category-button\.is-active \{[\s\S]{0,180}background: rgb\(255 255 255/);
assert.match(detail, /\.gallery-category-active-marker \{[\s\S]*height: 2rpx;[\s\S]*background: var\(--brand\);/);
assert.match(detail, /\.gallery-category-active-marker \{[\s\S]*bottom: 6rpx;[\s\S]*height: 2rpx;/);
assert.doesNotMatch(detail, /hero-count|gallery-category-count/);
assert.match(detail, /\.hero,[\s\S]*\.hero-image \{[\s\S]*height: 330rpx;/);

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

assert.match(detail, /heartActive: '\/static\/merchant-detail-icons\/heart-filled-warm\.png'/);
assert.match(detail, /favoriteState \? uiIcons\.heartActive : uiIcons\.heartGreen/);
assert.match(detail, /favoriteState\.value = isFavorite\(merchant\.value\.id\)/);
assert.match(detail, /favoriteGate\.toggle\(\{[\s\S]*merchantId: merchant\.value\.id,[\s\S]*currentState: favoriteState\.value,/);
assert.match(detail, /const result = setFavorite\(currentMerchant, desiredState\)/);
assert.match(
  detail,
  /onHide\(\(\) => \{[\s\S]*favoriteGate\.setActive\(false\);[\s\S]*favoriteLoginUi\.value\?\.close\(\);[\s\S]*\}\);/,
);
assert.match(
  detail,
  /onUnload\(\(\) => \{[\s\S]*favoriteGate\.setActive\(false\);[\s\S]*favoriteLoginUi\.value\?\.close\(\);[\s\S]*\}\);/,
);
assert.match(detail, /onShareAppMessage\(\(\) => \(\{/);
assert.match(detail, /onShareTimeline\(\(\) => \(\{/);
assert.match(favorites, /export function isFavorite/);
assert.match(favorites, /export function setFavorite/);
assert.match(favorites, /export function toggleFavorite/);
assert.match(favoriteGate, /desiredState: !input\.currentState/);
assert.match(favoriteGate, /errorStatusCode\(error\) === 401 && intent\.reauthAttempts === 0/);
assert.match(detail, /\.meta-type \{[\s\S]*background: var\(--brand-deep\);/);
assert.match(detail, /font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif;/);
assert.match(detail, /--type-title-size: 35rpx;/);
assert.match(detail, /--type-section-size: 29rpx;/);
assert.match(detail, /--type-body-size: 24rpx;/);
assert.match(detail, /--type-label-size: 22rpx;/);
assert.match(detail, /\.description,[\s\S]*\.claim-description \{[\s\S]*font-size: var\(--type-body-size\);/);
assert.match(detail, /\.sticky-orders button \{[\s\S]*font-size: var\(--type-label-size\);[\s\S]*font-weight: 700;/);
assert.match(detail, /\.dish-grid \.hot-sales,[\s\S]*font-size: var\(--type-meta-size\);/);

for (const viewportWidth of [375, 390, 430]) {
  const minimumCategoryTapHeight = (88 * viewportWidth) / 750;
  assert.ok(
    minimumCategoryTapHeight >= 44,
    `gallery category tap target must stay at least 44px at ${viewportWidth}px`,
  );
}

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
  zh: ['商家已入驻', '平台收录', '这是您的商家？', '免费认领'],
  vi: ['Đã tham gia YunQiao', 'Có mặt trên YunQiao', 'Đây là cửa hàng của bạn?', 'Nhận miễn phí'],
  en: ['Merchant onboarded', 'Listed on YunQiao', 'Is this your business?', 'Claim for free'],
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
