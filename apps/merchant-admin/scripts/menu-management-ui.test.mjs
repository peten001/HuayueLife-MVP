import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/ProductsPage.vue', import.meta.url), 'utf8');

assert.match(page, /class="table-shell product-table-shell"/, 'product table should have an overflow-specific shell');
assert.match(page, /<colgroup>[\s\S]*?product-column[\s\S]*?actions-column/, 'desktop product table should declare all six column tracks');
assert.match(page, /\.product-table \{[\s\S]*?min-width: 0;[\s\S]*?table-layout: fixed;/, 'desktop product table should size from its real container');
assert.match(page, /\.product-table-shell \{[\s\S]*?overflow-x: clip;/, 'desktop product list must not depend on horizontal scrolling');
assert.doesNotMatch(page, /\.product-table \{\s*min-width: 900px;/, 'legacy 900px table floor must be removed');
assert.match(page, /\.products-dashboard \{[\s\S]*?minmax\(216px, 240px\)[\s\S]*?minmax\(0, 1fr\)/, 'filter rail and list should share desktop width deliberately');
assert.match(page, /text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/, 'multilingual table copy should truncate safely');
assert.match(page, /:title="row\.nameZh"/, 'full dish names should remain available on hover');
assert.match(page, /:title="row\.category\?\.nameZh \|\| '—'"/, 'full category names should remain available on hover');
assert.match(page, /class="text-action menu-row-action"[\s\S]*?\{\{ t\('edit'\) \}\}/, 'desktop edit action should use a visible text label');
assert.match(page, /class="text-action danger menu-row-action"[\s\S]*?\{\{ t\('delete'\) \}\}/, 'desktop delete action should use a visible text label');
assert.match(page, /@media \(max-width: 768px\)/, 'menu management should use the shared 768px mobile boundary');
assert.match(page, /product-mobile-list/, 'mobile menu management should expose a card list');
assert.match(page, /\.product-table-shell \{\s*display: none;/, 'the wide table should be replaced on mobile');
assert.match(page, /min-height: 44px/, 'mobile product actions should meet the touch target floor');
assert.match(page, /product-mobile-empty empty-state/, 'mobile menu management should retain a useful empty state');
assert.match(page, /:focus-visible/, 'menu actions should keep a visible keyboard focus state');
assert.match(page, /unit: productForm\.unit\.trim\(\) \|\| null/, 'product create and edit payloads should persist or clear the optional unit');
assert.match(page, /v-model="productForm\.unit"/, 'product form should expose the unit input');
assert.match(page, /t\('productUnitPlaceholder'\)/, 'product unit should use localized placeholder copy');
assert.match(page, /maxlength="32"/, 'product unit input should match the API length contract');
assert.match(page, /v-if="row\.unit\?\.trim\(\)"[\s\S]*\{\{ row\.unit \}\}/, 'desktop and mobile product views should show non-empty units only');
assert.match(page, /\.price-stack \{[\s\S]*?justify-items: end;/, 'unit display should remain subordinate to the numeric price');

console.log('menu management UI checks passed');
