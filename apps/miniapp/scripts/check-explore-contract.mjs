import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
async function sourceModule(relative) {
  const source = await readFile(path.join(root, relative), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const commerce = await sourceModule('src/utils/merchant-discovery.ts');
const facility = (code, isEnabled = true) => ({ id: code, code, nameZh: code, isEnabled });
const cardMerchant = { dineInEnabled: true, qrOrderEnabled: true, pickupEnabled: true, deliveryEnabled: true, capabilities: [facility('chineseServiceEnabled'), facility('privateRoomEnabled'), facility('airConditioningEnabled'), facility('freeWifiEnabled'), facility('printerEnabled'), facility('zaloReportEnabled')] };
assert.deepEqual(commerce.merchantServiceBadges(cardMerchant, true).map(item => item.code), ['dineInEnabled','pickupEnabled','deliveryEnabled'], 'browsing cards show only the three main dining options even when other capabilities are enabled');
assert.deepEqual(commerce.merchantServiceBadges({ ...cardMerchant, dineInEnabled: false, qrOrderEnabled: false, pickupEnabled: false, deliveryEnabled: false, supportedOrderTypes: ['DINE_IN','PICKUP','DELIVERY'], capabilities: cardMerchant.capabilities.map(item => ({ ...item, isEnabled: false })) }, true), [], 'disabled flags cannot be inferred from industry, order types or other services');
assert.deepEqual(commerce.merchantServiceBadges(cardMerchant, false), [], 'non-restaurant browsing cards do not imply restaurant ordering');
assert.deepEqual(commerce.merchantServiceBadges({ capabilities: [facility('freeWifiEnabled'), facility('freeWifiEnabled')], supportedOrderTypes: ['PICKUP','DELIVERY'] }, true), [], 'absent switches cannot be inferred from order types or facilities');
const photoMerchant = {id:'meal', businessType:{code:'CHINESE_RESTAURANT'}, coverUrl:'cover', logoUrl:'logo', signatureDishes:[{imageUrl:'dish',sortOrder:0}], images:[{imageType:'MENU',imageUrl:'menu',sortOrder:0},{imageType:'LICENSE',imageUrl:'licence',sortOrder:0},{imageType:'PRODUCT',imageUrl:'hidden',sortOrder:0,isVisible:false},{imageType:'PRODUCT',imageUrl:'product',sortOrder:2},{imageType:'COVER',imageUrl:'cover',sortOrder:1}]};
assert.deepEqual(commerce.merchantDiscoveryPhotos(photoMerchant), ['dish','product','cover','logo'], 'use genuine dish/product photos, exclude hidden images and documents, remove duplicates');
const coffeeMerchant = {id:'coffee',businessType:{code:'COFFEE_TEA'},coverUrl:'coffee',images:[{imageType:'PRODUCT',imageUrl:'coffee-product',sortOrder:0}]};
assert.equal(commerce.merchantDiscoveryPhotos(coffeeMerchant)[0],'coffee','cafe atmosphere uses the designated cover before product posters');
assert.deepEqual(commerce.merchantSpotlights([{id:'no-photo'},coffeeMerchant,photoMerchant]).map(item=>item.merchant.id), ['meal','coffee'], 'lead with rich imagery and mix industries without duplicating stores');
assert.equal(commerce.merchantSpotlights([photoMerchant],new Set(['dish','product','cover','logo'])).length,0,'unloadable photos must never leave a broken hero');
assert.equal(commerce.merchantSpotlights([photoMerchant],new Set(['dish']))[0].photo,'product','failed images fall back to the next real image');
assert.deepEqual(commerce.merchantSpotlights([]),[]);
const home = await sourceModule('src/pages/home/home-list-state.ts');
const recommendations = await sourceModule('src/pages/home/home-recommendation-state.ts');
assert.deepEqual(recommendations.homeRecommendationContext('Bac Giang', 'Bac Giang', 21.123456789, 106.123456789), { province: '北江', lat: 21.1234568, lng: 106.1234568 });
assert.deepEqual(recommendations.homeRecommendationContext('Bac Ninh', 'Bac Giang', 21, 106), { province: '北宁' }, 'manually selected city cannot reuse another city GPS');
assert.deepEqual(recommendations.homeRecommendationContext('Bac Giang', null, null, null), { province: '北江' }, 'permission denied falls back to selected city');
assert.equal(recommendations.homeRecommendationContext(null, 'Bac Giang', 21, 106), null);
assert.equal(recommendations.recommendationRefreshDelay({ refreshAfterSeconds: 60 }), 60_000);
assert.equal(recommendations.recommendationRefreshDelay({ refreshAfterSeconds: 900 }), 300_000);
assert.equal(recommendations.recommendationResponseIsCurrent(1, 2, '北江', '北宁', true), false, 'late city response cannot overwrite new recommendations');
assert.equal(recommendations.recommendationResponseIsCurrent(2, 2, '北宁', '北宁', false), false, 'background response cannot restart the refresh timer');
assert.equal(recommendations.recommendationResponseIsCurrent(2, 2, '北宁', '北宁', true), true);
const discovery = await sourceModule('src/utils/discovery-categories.ts');
const categoryPages = discovery.discoveryCategoryPages([
  ...Array.from({ length: 13 }, (_, i) => ({ code: `live-${i}`, enabled: true })),
  { code: 'hidden', enabled: false },
  { code: 'all', enabled: true, navigationOnly: true },
]);
assert.deepEqual(categoryPages.map(page => page.length), [10, 3], 'categories use two-row pages without a reserved navigation slot');
assert.deepEqual(categoryPages.flat().map(item => item.code), Array.from({ length: 13 }, (_, i) => `live-${i}`), 'paging must keep every enabled category once and in platform order');
assert.equal(categoryPages.flat().some(item => item.code === 'hidden' || item.navigationOnly), false);
assert.equal(discovery.discoveryCategoryPages([{ code: 'food', enabled: true }])[0].length, 1);
assert.deepEqual(discovery.discoveryCategoryPages([]), []);
assert.deepEqual(discovery.discoveryCategoryPages(Array.from({ length: 23 }, (_, i) => ({ code: `live-${i}`, enabled: true }))).map(page => page.length), [10, 10, 3]);
const tags = await sourceModule('../api/src/modules/shared/homepage-category-keys.ts');
const adminCategories = await sourceModule('../merchant-admin/src/utils/merchant-categories.ts');
assert.deepEqual(adminCategories.MERCHANT_CATEGORY_OPTIONS.map(item => item.value).sort(), [...tags.HOMEPAGE_CATEGORY_KEYS].sort(), 'admin category choices must match API validation, including all new cuisines');
const flatCategories = [{ code: 'food', enabled: true }, { code: 'chinese_dining', enabled: true }, { code: 'coffee', enabled: true }, { code: 'japanese_food', enabled: true }];
assert.equal(discovery.discoveryFlatCategoryCode(flatCategories, 'food', 'chinese_dining'), 'chinese_dining', 'old shared links must open the merged top-level category');
assert.equal(discovery.discoveryFlatCategoryCode(flatCategories, 'food', 'coffee_milk_tea'), 'coffee');
assert.equal(discovery.discoveryFlatCategoryCode(flatCategories, 'japanese_food', ''), 'japanese_food');
assert.equal(discovery.discoveryFlatCategoryCode(flatCategories, 'food', 'unknown'), 'food');
for (const item of tags.DINING_CATEGORY_DEFINITIONS) {
  const artwork = discovery.discoveryCategoryArtwork({ code: item.key, iconKey: item.iconKey });
  assert.ok(artwork, `missing artwork for ${item.key}`);
  await readFile(path.join(root, 'src', artwork));
}
assert.notEqual(discovery.discoveryCategoryArtwork({ code: 'food', iconKey: 'food' }), discovery.discoveryCategoryArtwork({ code: 'popular_food', iconKey: 'food' }));
assert.notEqual(discovery.discoveryCategoryArtwork({ code: 'chinese_dining', iconKey: 'chinese' }), discovery.discoveryCategoryArtwork({ code: 'sichuan_hunan', iconKey: 'chinese' }));
const foodCategory = { code: 'food', enabled: true, legacyKeys: ['popular_food', 'chinese_dining', 'noodles_snacks', 'vietnamese_food'] };
const foodQuery = { category: foodCategory, region: 'Bac Ninh', subcategory: 'chinese_dining', keyword: '  火锅  ', openOnly: true };
assert.deepEqual(discovery.discoveryMerchantQuery(foodQuery, 2), { page: 2, province: '北宁', exploreCategory: 'food', homepageCategoryKey: 'chinese_dining', keyword: '火锅', serviceFilter: ['OPEN'] });
assert.equal(discovery.discoveryMerchantQuery({ ...foodQuery, subcategory: 'flowers_gifts' }, 1).homepageCategoryKey, undefined, 'foreign leaf categories must not leak into an industry');
assert.deepEqual(discovery.discoveryMerchantQuery({ ...foodQuery, keyword: '', subcategory: '', openOnly: false }, 1), { page: 1, province: '北宁', exploreCategory: 'food' });
assert.equal(discovery.discoveryPageUrl(foodCategory, 'Bac Giang', 'chinese_dining'), '/pages/discovery/index?category=food&region=Bac%20Giang&subcategory=chinese_dining');
assert.equal(discovery.discoveryPageUrl(foodCategory, 'unsupported', 'fresh_fruit'), '/pages/discovery/index?category=food');
assert.equal(discovery.discoveryRegion('Bac%20Giang'), 'Bac Giang', 'native route parameters may still be percent-encoded');
assert.equal(discovery.discoveryRegion('Bac Ninh'), 'Bac Ninh');
assert.equal(discovery.discoveryRegion('%'), '');
assert.equal(discovery.discoveryRegion('Shanghai'), '');
const template = await sourceModule('src/utils/merchant-content-template.ts');
const gallery = await sourceModule('src/pages/merchant/merchant-gallery-state.ts');
const largeGallery = Array.from({ length: 24 }, (_, index) => ({ id: String(index), imageType: 'PRODUCT', imageUrl: `photo-${index}`, sortOrder: index, isVisible: true }));
assert.equal(gallery.galleryImageUrls(largeGallery, 'PRODUCT').length, 24, 'all uploaded product photos remain accessible beyond the former six-photo limit');
assert.deepEqual(gallery.galleryImageUrls([...largeGallery, { ...largeGallery[0], id: 'duplicate' }, { ...largeGallery[0], id: 'hidden', imageUrl: 'hidden-photo', isVisible: false }, { ...largeGallery[0], id: 'menu', imageUrl: 'menu-poster', imageType: 'MENU' }], 'PRODUCT'), largeGallery.map(image => image.imageUrl), 'gallery sorting, hidden-image filtering and deduplication remain intact without a count ceiling');
const request = { regionCode: 'Bac Giang', mode: 'province', exploreCategory: 'hotel', exploreTopic: 'friends', serviceFilters: [] };
assert.deepEqual(home.merchantQueryForPage(request, 2), { page: 2, province: '北江', exploreCategory: 'hotel', exploreTopic: 'friends' });
assert.deepEqual(home.merchantQueryForPage({ ...request, keyword: '  Sample  ' }, 1), { page: 1, keyword: 'Sample', exploreCategory: 'hotel', exploreTopic: 'friends' });
for (const changed of [{ ...request, exploreCategory: 'massage' }, { ...request, exploreTopic: 'after-work' }, { ...request, regionCode: 'Bac Ninh' }]) assert.notEqual(home.merchantQueryKey(changed), home.merchantQueryKey(request));
const regional = { enabled: true, regions: ['北江'] };
assert.equal(home.isExploreTopicInRegion(regional, 'Bac Giang'), true);
assert.equal(home.isExploreTopicInRegion(regional, 'Bac Ninh'), false);
assert.equal(home.isExploreTopicInRegion(regional, undefined), false);
assert.equal(home.isExploreTopicInRegion({ ...regional, enabled: false }, 'Bac Giang'), false);
assert.equal(home.isExploreTopicInRegion({ enabled: true, regions: [] }, undefined), true);
for (const code of ['MASSAGE_SPA', 'HOTEL', 'KTV', 'HAIR_BEAUTY', 'SPORT_LEISURE']) {
  for (const claimStatus of ['CLAIMED', 'UNCLAIMED']) assert.equal(template.resolveContentTemplate({ businessType: { code }, claimStatus }), 'SERVICE');
}
assert.equal(template.resolveContentTemplate({ businessType: { code: 'CONVENIENCE_MARKET' } }), 'RETAIL');
assert.equal(template.resolveContentTemplate({ businessType: { code: 'UNKNOWN' } }), 'GENERAL');
assert.equal(template.resolveContentTemplate({ businessType: { code: 'COFFEE_TEA' } }), 'RESTAURANT');
assert.equal(template.resolveContentTemplate({ contentTemplate: 'RESTAURANT' }), 'RESTAURANT');
const media = gallery.flattenGalleryMedia([{ key: 'COVER', label: '封面', urls: ['cover'] }, { key: 'ENVIRONMENT', label: '环境', urls: ['store', 'room'] }, { key: 'SERVICE', label: '项目', urls: ['service'] }]);
assert.equal(gallery.firstGalleryIndexForCategory(media, 'SERVICE'), 3);
assert.equal(gallery.galleryCategoryForIndex(media, 2), 'ENVIRONMENT');
assert.equal(gallery.reconcileGalleryIndex(media, media, 3), 3);
console.log('PASS Explore queries, city/topic applicability, claim-independent templates and continuous service gallery');
