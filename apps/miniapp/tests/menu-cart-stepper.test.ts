import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const miniappRoot = path.resolve(import.meta.dirname, '..');

test('menu replaces the add button with an inline cart quantity stepper', async () => {
  const menu = await readFile(path.join(miniappRoot, 'src/pages/menu/index.vue'), 'utf8');

  assert.match(menu, /const cartItemsByProductId = computed/);
  assert.match(menu, /v-if="product\.status !== 'SOLD_OUT' && productQuantity\(product\.id\) > 0"/);
  assert.match(menu, /@click\.stop="decrease\(product\.id\)"/);
  assert.match(menu, /\{\{ productQuantity\(product\.id\) \}\}/);
  assert.match(menu, /@click\.stop="add\(product\)"/);
});

test('successful menu additions rely on the visible quantity and do not show a toast', async () => {
  const menu = await readFile(path.join(miniappRoot, 'src/pages/menu/index.vue'), 'utf8');
  const addBlock = menu.match(/async function add\(product: Product\) \{[\s\S]*?\n\}/)?.[0] ?? '';

  assert.match(addBlock, /await cartStore\.add\(product\.id\);/);
  assert.doesNotMatch(addBlock, /addToCartSuccess|icon:\s*'success'/);
  assert.match(addBlock, /addToCartFailed/);
});

test('decrement keeps the existing cart update and removal behavior', async () => {
  const menu = await readFile(path.join(miniappRoot, 'src/pages/menu/index.vue'), 'utf8');
  const decreaseBlock = menu.match(/async function decrease\(productId: string\) \{[\s\S]*?\n\}/)?.[0] ?? '';

  assert.match(decreaseBlock, /cartStore\.setQuantity\(item\.id, item\.quantity - 1\)/);
  assert.match(decreaseBlock, /updateFailed/);
});
