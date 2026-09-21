import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const miniappRoot = path.resolve(import.meta.dirname, '..');

test('order chat asks the user to choose and confirm a location before sending', async () => {
  const media = await readFile(path.join(miniappRoot, 'src/utils/order-chat-media.ts'), 'utf8');
  const page = await readFile(path.join(miniappRoot, 'src/pages/order/chat.vue'), 'utf8');

  assert.match(media, /uni\.chooseLocation\(/);
  assert.doesNotMatch(media, /uni\.getLocation\(/);
  assert.match(page, /pendingLocation\.value = await chooseChatLocation\(\)/);
  assert.match(page, /async function confirmSendLocation\(\)/);
  assert.ok(
    page.indexOf('pendingLocation.value = await chooseChatLocation()')
      < page.indexOf('sendOrderChatLocation(activeOrderId'),
  );
});

test('order chat uses a compact WeChat-style attachment tray and one safe-area owner', async () => {
  const page = await readFile(path.join(miniappRoot, 'src/pages/order/chat.vue'), 'utf8');
  const panel = await readFile(path.join(miniappRoot, 'src/components/OrderChatPanel.vue'), 'utf8');

  for (const source of [page, panel]) {
    assert.match(source, /class="composer-dock"/);
    assert.match(source, /<input[\s\S]*class="composer-input"/);
    assert.doesNotMatch(source, /<textarea[\s\S]*class="composer-input"/);
    assert.match(source, /getComposerSafeAreaGap\(\)/);
    assert.match(source, /line-height: 88rpx/);
    assert.match(source, /class="attachment-panel"/);
    assert.match(source, /class="more-symbol">＋/);
    assert.match(source, /OrderChatLocationPreview/);
    assert.doesNotMatch(source, /composer-attachments/);
    assert.doesNotMatch(source, /--message-list-bottom-gap/);
  }
});

test('location previews use the native MiniApp map without any external map key', async () => {
  const preview = await readFile(
    path.join(miniappRoot, 'src/components/OrderChatLocationPreview.vue'),
    'utf8',
  );

  assert.match(preview, /<map/);
  assert.match(preview, /:markers="markers"/);
  assert.match(preview, /:enable-scroll="false"/);
  assert.match(preview, /openChatLocation/);
  assert.doesNotMatch(preview, /Google|maps\.googleapis\.com|downloadOrderChatLocationPreview/);
});
