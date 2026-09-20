import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  isCurrentWechatTimelinePreview,
  isWechatTimelinePreview,
} from '../src/utils/wechat-entry-mode.ts';

const miniappRoot = path.resolve(import.meta.dirname, '..');

test('only the WeChat timeline single-page preview is browse-only', () => {
  assert.equal(isWechatTimelinePreview({ scene: 1154 }), true);
  assert.equal(isWechatTimelinePreview({ scene: '1154' }), true);
  assert.equal(isWechatTimelinePreview({ apiCategory: 'browseOnly' }), true);
  assert.equal(isWechatTimelinePreview({ scene: 1155 }), false);
  assert.equal(isWechatTimelinePreview({ scene: 1007 }), false);
  assert.equal(isWechatTimelinePreview(undefined), false);
});

test('current entry takes precedence over an earlier preview launch', () => {
  const runtime = globalThis as typeof globalThis & {
    wx?: {
      getEnterOptionsSync?: () => { scene: number };
      getLaunchOptionsSync?: () => { scene: number };
    };
  };
  const previous = runtime.wx;
  try {
    runtime.wx = {
      getEnterOptionsSync: () => ({ scene: 1155 }),
      getLaunchOptionsSync: () => ({ scene: 1154 }),
    };
    assert.equal(isCurrentWechatTimelinePreview(), false);
    runtime.wx.getEnterOptionsSync = () => ({ scene: 1154 });
    assert.equal(isCurrentWechatTimelinePreview(), true);
    delete runtime.wx.getEnterOptionsSync;
    assert.equal(isCurrentWechatTimelinePreview(), true);
  } finally {
    runtime.wx = previous;
  }
});

test('merchant ordering buttons stop before cart and login in timeline preview', async () => {
  const detail = await readFile(path.join(miniappRoot, 'src/pages/merchant/detail.vue'), 'utf8');
  const openMenu = detail.match(/async function openMenu\(orderType: 'PICKUP' \| 'DELIVERY'\) \{[\s\S]*?\n\}/)?.[0] ?? '';

  assert.match(openMenu, /isCurrentWechatTimelinePreview\(\)/);
  assert.match(openMenu, /t\('timelinePreviewOrderingHint'\)/);
  assert.ok(openMenu.indexOf('isCurrentWechatTimelinePreview()') < openMenu.indexOf('cartStore.ensureLoaded()'));
  assert.match(openMenu, /cartStore\.switchContext\(nextContext\)/);
  assert.match(openMenu, /uni\.navigateTo\(/);
});
