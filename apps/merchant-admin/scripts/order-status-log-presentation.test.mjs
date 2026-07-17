import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { orderStatusLogActionPresentation } = await server.ssrLoadModule(
    '/src/utils/order-status-log-presentation.ts',
  );
  const { useI18n } = await server.ssrLoadModule('/src/i18n/index.ts');
  const { setLocale, t } = useI18n();

  const addItems = orderStatusLogActionPresentation({
    action: 'MERCHANT_ADD_ITEMS',
    metadata: { productName: 'must-not-render' },
  });
  const decreased = orderStatusLogActionPresentation({
    action: 'ORDER_ITEM_DECREASED',
    metadata: {
      productName: 'Beef Pho',
      beforeQuantity: 2,
      afterQuantity: 1,
      requestKey: 'must-not-render',
      orderItemId: 'must-not-render',
    },
  });
  const returned = orderStatusLogActionPresentation({
    action: 'ORDER_ITEM_RETURNED',
    metadata: { productName: 'Spring Roll', returnedQuantity: 1 },
  });

  assert.deepEqual(addItems, { labelKey: 'merchantAddItemsAction' });
  assert.deepEqual(decreased, {
    labelKey: 'orderItemDecreasedAction',
    params: { name: 'Beef Pho', beforeQuantity: 2, afterQuantity: 1 },
  });
  assert.deepEqual(returned, {
    labelKey: 'orderItemReturnedAction',
    params: { name: 'Spring Roll', returnedQuantity: 1 },
  });
  assert.equal(
    orderStatusLogActionPresentation({ action: null, metadata: null }),
    null,
  );

  const expectedByLocale = {
    zh: ['商家点菜', '减菜：Beef Pho 2 → 1', '退菜：Spring Roll × 1'],
    vi: ['Nhà hàng thêm món', 'Giảm món: Beef Pho 2 → 1', 'Trả món: Spring Roll × 1'],
    en: ['Merchant added items', 'Decrease item: Beef Pho 2 → 1', 'Return item: Spring Roll × 1'],
  };

  for (const [locale, expected] of Object.entries(expectedByLocale)) {
    setLocale(locale);
    const actual = [addItems, decreased, returned].map((row) =>
      t(row.labelKey, row.params),
    );
    assert.deepEqual(actual, expected);
    assert.equal(actual.some((label) => label.includes('must-not-render')), false);
  }

  const malformedDecrease = orderStatusLogActionPresentation({
    action: 'ORDER_ITEM_DECREASED',
    metadata: { productName: '', beforeQuantity: 2, afterQuantity: 1 },
  });
  assert.deepEqual(malformedDecrease, {
    labelKey: 'orderItemDecreasedActionFallback',
  });

  const page = await readFile(new URL('../src/pages/OrderDetailPage.vue', import.meta.url), 'utf8');
  assert.match(page, /<strong v-if="row\.action">/);
  assert.match(page, /<strong v-else>/);
  assert.match(page, /statusTimeline/);
  assert.doesNotMatch(page, /log\.fromStatus\) }} → {{ statusLabel\(log\.toStatus/);

  console.log('merchant-admin order status log presentation: PASS');
} finally {
  await server.close();
}
