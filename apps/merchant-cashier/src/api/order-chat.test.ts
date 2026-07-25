import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  demoActive: false,
  requestApi: vi.fn(),
}));

vi.mock('@/fixtures/runtime', () => ({
  isDemoSessionActive: () => mocks.demoActive,
}));

vi.mock('./http', () => ({
  requestApi: mocks.requestApi,
}));

import {
  listMerchantOrderChatMessages,
  sendMerchantOrderChatMessage,
} from './order-chat';
import { resetDemoRepository } from '@/fixtures/repository';

describe('cashier order chat API routing', () => {
  beforeEach(() => {
    mocks.demoActive = false;
    mocks.requestApi.mockReset();
    resetDemoRepository();
  });

  it('always uses the real API when no demo session is active', async () => {
    mocks.requestApi.mockResolvedValueOnce({
      items: [],
      pageInfo: { hasMore: false, nextCursor: null },
    });

    await listMerchantOrderChatMessages('order / 1', {
      cursor: ' 42 ',
      limit: 200,
    });

    expect(mocks.requestApi).toHaveBeenCalledWith(
      '/merchant/orders/order%20%2F%201/chat/messages',
      expect.objectContaining({ query: { cursor: '42', limit: 50 } }),
    );
  });

  it('keeps demo messages inside the demo branch without calling the real API', async () => {
    mocks.demoActive = true;

    const sent = await sendMerchantOrderChatMessage('demo-order', 'demo message');
    const page = await listMerchantOrderChatMessages('demo-order');

    expect(mocks.requestApi).not.toHaveBeenCalled();
    expect(sent.orderId).toBe('demo-order');
    expect(page.items.map((message) => message.content)).toContain('demo message');
  });

  it('clears demo chat messages and their sequence with the demo repository', async () => {
    mocks.demoActive = true;
    const first = await sendMerchantOrderChatMessage('demo-order', 'old session');
    expect(first.id).toBe('1');

    resetDemoRepository();

    const cleared = await listMerchantOrderChatMessages('demo-order');
    const next = await sendMerchantOrderChatMessage('demo-order', 'new session');
    expect(cleared.items).toEqual([]);
    expect(next.id).toBe('1');
    expect(mocks.requestApi).not.toHaveBeenCalled();
  });
});
