import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTableQrLaunchInput } from '../src/utils/table-qr-launch-input.ts';

const TOKEN = 'a'.repeat(64);
const TABLE_QR_URL = `https://api.huayueyouxuan.com/t/${TOKEN}`;

test('accepts encoded and already decoded canonical q values', () => {
  assert.deepEqual(parseTableQrLaunchInput({ q: encodeURIComponent(TABLE_QR_URL) }), {
    token: TOKEN,
  });
  assert.deepEqual(parseTableQrLaunchInput({ q: TABLE_QR_URL }), { token: TOKEN });
  assert.deepEqual(parseTableQrLaunchInput({ q: `https://api.huayueyouxuan.com:443/t/${TOKEN}` }), {
    token: TOKEN,
  });
});

test('rejects unsafe q URLs and invalid token paths', () => {
  const invalidValues = [
    `http://api.huayueyouxuan.com/t/${TOKEN}`,
    `javascript://api.huayueyouxuan.com/t/${TOKEN}`,
    `data://api.huayueyouxuan.com/t/${TOKEN}`,
    `file://api.huayueyouxuan.com/t/${TOKEN}`,
    `https://evil.com/t/${TOKEN}`,
    `https://api.huayueyouxuan.com.evil.com/t/${TOKEN}`,
    `https://user@api.huayueyouxuan.com/t/${TOKEN}`,
    `https://api.huayueyouxuan.com:444/t/${TOKEN}`,
    `https://api.huayueyouxuan.com/t/${'a'.repeat(63)}`,
    `https://api.huayueyouxuan.com/t/${'a'.repeat(65)}`,
    `https://api.huayueyouxuan.com/t/${'g'.repeat(64)}`,
    `https://api.huayueyouxuan.com/t/${'A'.repeat(64)}`,
    `https://api.huayueyouxuan.com/t/${TOKEN}/extra`,
    `https://api.huayueyouxuan.com/foo/t/${TOKEN}`,
    `https://api.huayueyouxuan.com/t/${TOKEN}?source=wechat`,
    `https://api.huayueyouxuan.com/t/${TOKEN}#fragment`,
    '',
    '%E0%A4%A',
    encodeURIComponent(encodeURIComponent(TABLE_QR_URL)),
  ];

  for (const q of invalidValues) {
    assert.equal(parseTableQrLaunchInput({ q }), null, q);
  }
});

test('preserves direct token and legacy scene inputs', () => {
  assert.deepEqual(parseTableQrLaunchInput({ token: TOKEN }), { token: TOKEN });
  assert.deepEqual(parseTableQrLaunchInput({ scene: 't18v2' }), { scene: 't18v2' });
  assert.equal(parseTableQrLaunchInput({ scene: '18v2' }), null);
  assert.equal(parseTableQrLaunchInput({ scene: 't18' }), null);
});

test('does not extract tokens from arbitrary legacy scan URLs', () => {
  assert.equal(parseTableQrLaunchInput({ result: `https://evil.com/?token=${TOKEN}` }), null);
  assert.deepEqual(parseTableQrLaunchInput({ result: TABLE_QR_URL }), { token: TOKEN });
  assert.equal(parseTableQrLaunchInput({ q: 'https://evil.com', result: TABLE_QR_URL }), null);
});
