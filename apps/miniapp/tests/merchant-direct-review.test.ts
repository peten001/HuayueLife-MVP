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
  assert.match(createPage, /uni\.compressImage\(/);
  assert.match(createPage, /compressedWidth/);
  assert.match(createPage, /MAX_REVIEW_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(createPage, /for \(const image of images\.value\)/);
  assert.doesNotMatch(createPage, /Promise\.all\(images\.value\.map/);
  assert.match(createPage, /imageTokens\.push\(image\.remoteToken\)/);
  assert.doesNotMatch(createPage, /delete image\.remoteToken/);
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
  assert.match(card, /resolveMediaUrl\(image\.thumbnailUrl \?\? undefined\) \|\| resolvedUrl/);
  assert.match(card, /@tap="previewImage\(image\.resolvedUrl\)"/);
  assert.match(card, /thumbnailFallbackIds\.has\(image\.id\) \? image\.resolvedUrl : image\.resolvedThumbnailUrl/);
  assert.match(types, /source: 'ORDER' \| 'DIRECT';/);
  assert.match(types, /thumbnailUrl\?: string \| null;/);
  assert.match(types, /orderType: OrderType \| null;/);
});

test('review copy does not use the removed completion-only prompt', async () => {
  const [createPage, i18n] = await Promise.all([
    readFile(path.join(miniappRoot, 'src/pages/review/create.vue'), 'utf8'),
    readFile(path.join(miniappRoot, 'src/i18n/index.ts'), 'utf8'),
  ]);

  assert.doesNotMatch(createPage, /directReviewLimitHint/);
  assert.doesNotMatch(i18n, /无需订单即可评价/);
  assert.match(i18n, /noReviewsHint: '还没有评价，来分享你的真实体验吧。'/);
  assert.match(i18n, /noReviewsHint: 'Chưa có đánh giá\. Hãy chia sẻ trải nghiệm của bạn\.'/);
  assert.match(i18n, /noReviewsHint: 'No reviews yet\. Share your experience\.'/);
  assert.match(i18n, /reviewPending: '评价已提交审核'/);
  assert.match(i18n, /reviewPendingHint: '内容安全检查通过后会公开展示'/);
  assert.match(i18n, /reviewPhotosHint: '最多 6 张，选择后自动压缩'/);
  assert.match(i18n, /reviewPhotosHint: 'Tối đa 6 ảnh, tự động nén sau khi chọn'/);
  assert.match(i18n, /reviewPhotosHint: 'Up to 6 photos, automatically compressed after selection'/);
});
