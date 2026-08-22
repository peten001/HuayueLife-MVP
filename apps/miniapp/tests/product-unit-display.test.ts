import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCartQuantity,
  formatProductUnitSuffix,
  normalizeProductUnit,
} from '../src/utils/product-unit-display.ts';

test('formats product price unit suffixes without changing the price formatter', () => {
  assert.equal(formatProductUnitSuffix('份'), '/ 份');
  assert.equal(formatProductUnitSuffix('串'), '/ 串');
  assert.equal(formatProductUnitSuffix(null), '');
  assert.equal(formatProductUnitSuffix(undefined), '');
  assert.equal(formatProductUnitSuffix(''), '');
  assert.equal(formatProductUnitSuffix('   '), '');
});

test('formats cart stepper quantities with an optional merchant-entered unit', () => {
  assert.equal(formatCartQuantity(2, '份'), '2 份');
  assert.equal(formatCartQuantity(5, '串'), '5 串');
  assert.equal(formatCartQuantity(2, null), '2');
  assert.equal(formatCartQuantity(2, undefined), '2');
  assert.equal(formatCartQuantity(2, ''), '2');
  assert.equal(formatCartQuantity(2, '   '), '2');
});

test('trims only the display value and preserves arbitrary multilingual units', () => {
  assert.equal(normalizeProductUnit('  chai  '), 'chai');
  assert.equal(formatProductUnitSuffix('  phần  '), '/ phần');
  assert.equal(formatCartQuantity(10, '  phần  '), '10 phần');
});
