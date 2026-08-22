import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const miniappRoot = path.resolve(import.meta.dirname, '..');
const helperPath = path.join(miniappRoot, 'src/pages/home/home-list-state.ts');
const pagePath = path.join(miniappRoot, 'src/pages/home/index.vue');

const helperSource = await readFile(helperPath, 'utf8');
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: helperPath,
}).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(helperJs).toString('base64')}`);
const page = await readFile(pagePath, 'utf8');

const baseQuery = {
  regionCode: 'Bac Giang',
  mode: 'province',
  homepageCategoryKey: 'coffee_milk_tea',
  keyword: '农品香',
  serviceFilters: ['OPEN', 'PICKUP'],
  latitude: 21.2,
  longitude: 106.2,
};

assert.deepEqual(helper.merchantQueryForPage(baseQuery, 2), {
  page: 2,
  homepageCategoryKey: 'coffee_milk_tea',
  keyword: '农品香',
  serviceFilter: ['OPEN', 'PICKUP'],
  lat: 21.2,
  lng: 106.2,
});

assert.deepEqual(helper.merchantQueryForPage({
  ...baseQuery,
  keyword: '   ',
}, 1), {
  province: '北江',
  page: 1,
  homepageCategoryKey: 'coffee_milk_tea',
  serviceFilter: ['OPEN', 'PICKUP'],
  lat: 21.2,
  lng: 106.2,
});

assert.deepEqual(helper.merchantQueryForPage({
  ...baseQuery,
  regionCode: 'Bac Ninh',
  keyword: undefined,
}, 1), {
  province: '北宁',
  page: 1,
  homepageCategoryKey: 'coffee_milk_tea',
  serviceFilter: ['OPEN', 'PICKUP'],
  lat: 21.2,
  lng: 106.2,
});

const baseKey = helper.merchantQueryKey(baseQuery);
for (const changed of [
  { ...baseQuery, regionCode: 'Bac Ninh' },
  { ...baseQuery, mode: 'nearby' },
  { ...baseQuery, homepageCategoryKey: 'fresh_fruit' },
  { ...baseQuery, keyword: '别的商家' },
  { ...baseQuery, serviceFilters: ['OPEN'] },
  { ...baseQuery, latitude: 21.3 },
]) {
  assert.notEqual(helper.merchantQueryKey(changed), baseKey);
}

const existing = [
  { id: '1', nameZh: '旧一' },
  { id: '2', nameZh: '旧二' },
];
const merged = helper.mergeMerchantPage(existing, [
  { id: '2', nameZh: '新二' },
  { id: '3', nameZh: '新三' },
  { id: '3', nameZh: '更新三' },
  { id: '4', nameZh: '新四' },
]);
assert.deepEqual(merged.map((item) => item.id), ['1', '2', '3', '4']);
assert.equal(merged[1].nameZh, '新二');
assert.equal(merged[2].nameZh, '更新三');

assert.equal(helper.hasMoreMerchantPages(1, 20, 21, false), true);
assert.equal(helper.hasMoreMerchantPages(2, 20, 21, false), false);
assert.equal(helper.hasMoreMerchantPages(1, 20, 100, true), false);
assert.equal(helper.hasMoreMerchantPages(0, 0, 100, false), false);

assert.equal(helper.isCurrentMerchantResponse(1, 'A', 3, 'A'), false);
assert.equal(helper.isCurrentMerchantResponse(2, 'B', 3, 'A'), false);
assert.equal(helper.isCurrentMerchantResponse(3, 'A', 3, 'A'), true);
assert.equal(helper.isCurrentLocationIntent(1, 2, 4, 4), false);
assert.equal(helper.isCurrentLocationIntent(1, 1, 4, 5), false);
assert.equal(helper.isCurrentLocationIntent(1, 1, 5, 5), true);

const id4Regression = helper.mergeMerchantPage([], [
  { id: '9', nameZh: '服务端第一位' },
  { id: '4', nameZh: 'Merchant 4' },
]);
assert.deepEqual(id4Regression.map((item) => item.id), ['9', '4']);

assert.match(page, /watch\(searchKeyword,[\s\S]*300/);
assert.match(page, /merchantQueryKey\(request\)/);
assert.match(page, /isCurrentMerchantResponse\(/);
assert.match(page, /isCurrentLocationIntent\(/);
assert.match(page, /mergeMerchantPage\(merchants\.value, rawList\)/);
assert.match(page, /hasMoreMerchantPages\(/);
assert.match(page, /merchantListError/);
assert.match(page, /retryMerchantList/);
assert.match(page, /keyword: normalizeKeyword\(searchKeyword\.value\)/);
assert.doesNotMatch(page, /categoryFilteredMerchants|filteredMerchants|visibleMerchants/);
assert.doesNotMatch(page, /manualPopular[\s\S]{0,120}sort|sort[\s\S]{0,120}manualPopular/);
assert.doesNotMatch(page, /compareDistance\(/);

console.log('check-home-query-state: PASS');
