import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const miniappRoot = path.resolve(import.meta.dirname, '..');

test('merchant detail opens the existing review form through the real login UI', async () => {
  const detail = await readFile(
    path.join(miniappRoot, 'src/pages/merchant/detail.vue'),
    'utf8',
  );

  assert.match(detail, /async function openReviewComposer\(\)/);
  assert.match(detail, /favoriteLoginUi\.value\?\.open\(\)/);
  assert.match(detail, /\/pages\/review\/create\?merchantId=\$\{activeMerchant\.id\}/);
  assert.match(detail, /t\('writeReview'\)/);
});

test('review form supports direct and order-linked entry without weakening the order path', async () => {
  const [createPage, reviewApi, ordersPage, orderDetail] = await Promise.all([
    readFile(path.join(miniappRoot, 'src/pages/review/create.vue'), 'utf8'),
    readFile(path.join(miniappRoot, 'src/api/reviews.ts'), 'utf8'),
    readFile(path.join(miniappRoot, 'src/pages/orders/index.vue'), 'utf8'),
    readFile(path.join(miniappRoot, 'src/pages/order/detail.vue'), 'utf8'),
  ]);

  assert.match(createPage, /options\?\.merchantId/);
  assert.match(createPage, /getOwnDirectReview\(merchantId\.value\)/);
  assert.match(createPage, /createDirectReview\(merchant\.value!\.id, input\)/);
  assert.match(createPage, /createReview\(order\.value\.id, input\)/);
  assert.match(reviewApi, /\/merchants\/\$\{merchantId\}\/reviews/);
  assert.match(reviewApi, /\/orders\/\$\{orderId\}\/review-images/);
  assert.match(ordersPage, /\/pages\/review\/create\?orderId=\$\{order\.id\}/);
  assert.match(orderDetail, /\/pages\/review\/create\?orderId=\$\{order\.value\.id\}/);
});

test('public review cards identify direct and post-visit reviews', async () => {
  const [card, types] = await Promise.all([
    readFile(path.join(miniappRoot, 'src/components/MerchantReviewCard.vue'), 'utf8'),
    readFile(path.join(miniappRoot, 'src/types/api.ts'), 'utf8'),
  ]);

  assert.match(card, /review\.source === 'ORDER' \? t\('reviewSourceOrder'\) : t\('reviewSourceDirect'\)/);
  assert.match(types, /source: 'ORDER' \| 'DIRECT';/);
  assert.match(types, /orderType: OrderType \| null;/);
});

test('review copy does not use the removed completion-only prompt', async () => {
  const i18n = await readFile(path.join(miniappRoot, 'src/i18n/index.ts'), 'utf8');

  assert.match(i18n, /noReviewsHint: '还没有评价，来分享你的真实体验吧。'/);
  assert.match(i18n, /noReviewsHint: 'Chưa có đánh giá\. Hãy chia sẻ trải nghiệm của bạn\.'/);
  assert.match(i18n, /noReviewsHint: 'No reviews yet\. Share your experience\.'/);
  assert.match(i18n, /reviewPending: '评价已提交审核'/);
  assert.match(i18n, /reviewPendingHint: '内容安全检查通过后会公开展示'/);
});
