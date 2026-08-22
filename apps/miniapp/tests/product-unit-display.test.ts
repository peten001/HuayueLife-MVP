import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  formatCartQuantity,
  formatProductUnitSuffix,
  normalizeProductUnit,
} from '../src/utils/product-unit-display.ts';

const miniappRoot = path.resolve(import.meta.dirname, '..');

test('formats product price units without changing the price value', () => {
  assert.equal(formatProductUnitSuffix('份'), '/ 份');
  assert.equal(formatProductUnitSuffix('杯'), '/ 杯');
  assert.equal(formatProductUnitSuffix(null), '');
  assert.equal(formatProductUnitSuffix(undefined), '');
  assert.equal(formatProductUnitSuffix(''), '');
  assert.equal(formatProductUnitSuffix('   '), '');
});

test('formats cart quantities for new and legacy cart responses', () => {
  assert.equal(formatCartQuantity(2, '份'), '2 份');
  assert.equal(formatCartQuantity(5, '杯'), '5 杯');
  assert.equal(formatCartQuantity(2, null), '2');
  assert.equal(formatCartQuantity(2, undefined), '2');
  assert.equal(formatCartQuantity(2, ''), '2');
  assert.equal(formatCartQuantity(2, '   '), '2');
});

test('trims only the display value and preserves multilingual units', () => {
  assert.equal(normalizeProductUnit('  chai  '), 'chai');
  assert.equal(formatProductUnitSuffix('  phần  '), '/ phần');
  assert.equal(formatCartQuantity(10, '  phần  '), '10 phần');
});

test('wires optional API units into menu and cart display without changing cart identity', async () => {
  const [types, menu, cart, cartStore] = await Promise.all([
    readFile(path.join(miniappRoot, 'src/types/api.ts'), 'utf8'),
    readFile(path.join(miniappRoot, 'src/pages/menu/index.vue'), 'utf8'),
    readFile(path.join(miniappRoot, 'src/pages/cart/index.vue'), 'utf8'),
    readFile(path.join(miniappRoot, 'src/stores/cart.ts'), 'utf8'),
  ]);

  assert.match(types, /unit\?: string \| null;/);
  assert.match(menu, /formatProductUnitSuffix\(product\.unit\)/);
  assert.match(cart, /formatCartQuantity\(item\.quantity, item\.product\.unit\)/);
  assert.match(cartStore, /async add\(productId: string, quantity = 1, remark = ''\)/);
  assert.doesNotMatch(cartStore, /unit[^\n]*(identity|key)|identity[^\n]*unit/i);
});

test('keeps the amount primary and protects unit text at supported widths', async () => {
  const [menu, cart] = await Promise.all([
    readFile(path.join(miniappRoot, 'src/pages/menu/index.vue'), 'utf8'),
    readFile(path.join(miniappRoot, 'src/pages/cart/index.vue'), 'utf8'),
  ]);

  assert.match(menu, /\.price-copy\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?flex:\s*1;[\s\S]*?overflow:\s*hidden;/);
  assert.match(menu, /\.price\s*\{[\s\S]*?flex:\s*none;[\s\S]*?font-size:\s*17px;[\s\S]*?font-weight:\s*800;/);
  assert.match(menu, /\.price-unit\s*\{[\s\S]*?font-size:\s*12px;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(cart, /\.quantity\s*\{[\s\S]*?max-width:\s*120rpx;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);

  for (const viewportWidth of [375, 390, 430]) {
    const unitMaxWidthPx = (120 * viewportWidth) / 750;
    assert.ok(unitMaxWidthPx >= 60 && unitMaxWidthPx <= 69);
  }
});
