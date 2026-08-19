import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(
  new URL('../src/pages/PlatformMerchantsPage.vue', import.meta.url),
  'utf8',
);
const detail = await readFile(
  new URL('../src/pages/PlatformMerchantDetailPage.vue', import.meta.url),
  'utf8',
);

// Quick-add coordinate fields must stay strings while editing so Vue's
// number-input casting never turns them into numbers mid-keystroke.
assert.match(
  page,
  /v-model="form\.latitude"[\s\S]{0,160}type="text"[\s\S]{0,120}inputmode="decimal"[\s\S]{0,120}placeholder="21\.28"/,
  'latitude input should use text + decimal inputmode',
);
assert.match(
  page,
  /v-model="form\.longitude"[\s\S]{0,160}type="text"[\s\S]{0,120}inputmode="decimal"[\s\S]{0,120}placeholder="106\.20"/,
  'longitude input should use text + decimal inputmode',
);
assert.doesNotMatch(
  page,
  /v-model="form\.(latitude|longitude)"[\s\S]{0,120}type="number"/,
  'coordinate v-model must not use a native number input',
);

// Both coordinate helpers must tolerate numeric and string values and never
// call .trim() directly on a possibly-numeric model value.
assert.match(
  page,
  /function validateCoordinate\(value: string \| number[\s\S]*?const trimmed = String\(value\)\.trim\(\);/,
  'validateCoordinate should normalize via String(value).trim()',
);
assert.match(
  page,
  /function parseOptionalCoordinate\(value: string \| number[\s\S]*?const trimmed = String\(value\)\.trim\(\);/,
  'parseOptionalCoordinate should normalize via String(value).trim()',
);

// Submit must still send parsed finite numbers, not raw strings.
assert.match(
  page,
  /const latitude = parseOptionalCoordinate\(form\.latitude\);/,
  'submit should parse latitude through parseOptionalCoordinate',
);
assert.match(
  page,
  /const longitude = parseOptionalCoordinate\(form\.longitude\);/,
  'submit should parse longitude through parseOptionalCoordinate',
);
assert.match(
  page,
  /createPlatformDisplayMerchant\(\{[\s\S]*?latitude,[\s\S]*?longitude,[\s\S]*?\}\)/,
  'create payload should pass the parsed latitude/longitude numbers',
);

// The merchant edit page keeps its own number-input contract untouched.
assert.match(
  detail,
  /v-model\.number="profileForm\.latitude" type="number"/,
  'merchant edit page latitude field should stay number-based',
);
assert.match(
  detail,
  /v-model\.number="profileForm\.longitude" type="number"/,
  'merchant edit page longitude field should stay number-based',
);

console.log('quick-add coordinate UI checks passed');
