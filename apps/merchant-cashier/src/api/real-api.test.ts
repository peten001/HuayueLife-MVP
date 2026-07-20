import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({
    code: status < 400 ? 'OK' : `HTTP_${status}`,
    message: status < 400 ? 'OK' : 'Request failed',
    data,
    requestId: 'request-test',
    timestamp: '2026-07-15T00:00:00.000Z',
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({
    code,
    message,
    data: null,
    requestId: 'request-error',
    timestamp: '2026-07-15T00:00:00.000Z',
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestPath(call: unknown[] | undefined) {
  return new URL(String(call?.[0])).pathname;
}

function requestInit(call: unknown[] | undefined) {
  return (call?.[1] ?? {}) as RequestInit;
}

async function loadApi(fixtureFlag = 'false') {
  vi.stubEnv('VITE_CASHIER_USE_FIXTURES', fixtureFlag);
  vi.resetModules();
  const [api, fixtures] = await Promise.all([
    import('./index'),
    import('@/fixtures'),
  ]);
  return { api, fixtures };
}

const table = {
  id: 'table-1',
  merchantId: 'merchant-1',
  tableNo: 'A01',
  tableName: 'A01',
  qrToken: 'not-a-real-token',
  qrVersion: 1,
  status: 'ACTIVE',
};

const order = {
  id: 'order-1',
  orderNo: 'TEST-1001',
  merchantId: 'merchant-1',
  orderType: 'DINE_IN',
  status: 'PENDING_ACCEPTANCE',
  itemAmountVnd: '120000',
  deliveryFeeVnd: '0',
  totalAmountVnd: '120000',
  settlementStatus: 'UNSETTLED',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  items: [],
};

const session = {
  id: 'session-1',
  sessionNo: 'SESSION-1',
  merchantId: 'merchant-1',
  tableId: 'table-1',
  tableNo: 'A01',
  tableName: 'A01',
  status: 'CLOSED',
  openedAt: '2026-07-15T00:00:00.000Z',
  closedAt: '2026-07-15T01:00:00.000Z',
  orderCount: 1,
  itemCount: 1,
  totalAmountVnd: '120000',
  latestOrderAt: '2026-07-15T00:10:00.000Z',
  pendingOrderCount: 0,
  unfinishedOrderCount: 0,
  orders: [],
};

describe('real merchant API contracts', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('handles real merchant login success and failure', async () => {
    const { api } = await loadApi();
    const loginResult = {
      accessToken: 'test-access-token',
      staff: {
        id: 'staff-1',
        displayName: 'Test Staff',
        username: 'cashier',
        role: 'MANAGER',
        mustChangePassword: false,
        merchant: { id: 'merchant-1', nameZh: 'Test Merchant', status: 'ACTIVE' },
      },
    };
    fetchMock.mockResolvedValueOnce(apiResponse(loginResult));

    await expect(api.loginMerchant('cashier', 'not-a-real-password')).resolves.toEqual(loginResult);
    expect(requestPath(fetchMock.mock.calls[0])).toBe('/api/v1/merchant/auth/login');
    expect(requestInit(fetchMock.mock.calls[0]).method).toBe('POST');

    fetchMock.mockResolvedValueOnce(apiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials'));
    await expect(api.loginMerchant('cashier', 'wrong-password')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('loads real tables and open TableSessions', async () => {
    const { api } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(apiResponse([table]))
      .mockResolvedValueOnce(apiResponse({ sessions: [{ ...session, status: 'OPEN', closedAt: null }] }));

    await expect(api.listDiningTables()).resolves.toEqual([table]);
    await expect(api.listOpenTableSessions()).resolves.toEqual([
      { ...session, status: 'OPEN', closedAt: null },
    ]);
    expect(fetchMock.mock.calls.map(requestPath)).toEqual([
      '/api/v1/merchant/tables',
      '/api/v1/merchant/table-sessions/open',
    ]);
  });

  it('loads pending orders with the real status query', async () => {
    const { api } = await loadApi();
    fetchMock.mockResolvedValueOnce(apiResponse([order]));

    await expect(api.listMerchantOrders({ status: 'PENDING_ACCEPTANCE' })).resolves.toEqual([order]);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe('/api/v1/merchant/orders');
    expect(requestUrl.searchParams.get('status')).toBe('PENDING_ACCEPTANCE');
  });

  it.each([
    ['accept', 'ACCEPTED'],
    ['complete', 'COMPLETED'],
  ] as const)('reports %s order action success and failure', async (action, nextStatus) => {
    const { api } = await loadApi();
    fetchMock.mockResolvedValueOnce(apiResponse({ ...order, status: nextStatus }));

    await expect(api.runMerchantOrderAction(order.id, action)).resolves.toMatchObject({
      id: order.id,
      status: nextStatus,
    });
    expect(requestPath(fetchMock.mock.calls[0])).toBe(`/api/v1/merchant/orders/order-1/${action}`);
    expect(requestInit(fetchMock.mock.calls[0]).method).toBe('POST');

    fetchMock.mockResolvedValueOnce(apiError(409, 'ORDER_STATUS_CONFLICT', 'Order status changed'));
    await expect(api.runMerchantOrderAction(order.id, action)).rejects.toMatchObject({
      status: 409,
      code: 'ORDER_STATUS_CONFLICT',
    });
  });

  it('reports TableSession close success and failure', async () => {
    const { api } = await loadApi();
    fetchMock.mockResolvedValueOnce(apiResponse({ session }));

    await expect(api.closeTableSession(session.id)).resolves.toEqual(session);
    expect(requestPath(fetchMock.mock.calls[0])).toBe(
      '/api/v1/merchant/table-sessions/session-1/close',
    );
    expect(requestInit(fetchMock.mock.calls[0]).method).toBe('POST');

    fetchMock.mockResolvedValueOnce(apiError(
      409,
      'TABLE_SESSION_HAS_UNFINISHED_ORDERS',
      'Table session has unfinished orders',
    ));
    await expect(api.closeTableSession(session.id)).rejects.toMatchObject({
      status: 409,
      code: 'TABLE_SESSION_HAS_UNFINISHED_ORDERS',
    });
  });

  it('loads the existing merchant menu APIs with only on-sale products', async () => {
    const { api } = await loadApi();
    const category = { id: 'category-1', nameZh: '主食', sortOrder: 1, isActive: true };
    const product = {
      id: 'product-1',
      categoryId: category.id,
      nameZh: '牛肉粉',
      priceVnd: '60000',
      sortOrder: 1,
      status: 'ON_SALE',
      productType: 'FOOD',
      category,
    };
    fetchMock
      .mockResolvedValueOnce(apiResponse([category]))
      .mockResolvedValueOnce(apiResponse([product]));

    await expect(api.listCashierMenuCategories()).resolves.toEqual([category]);
    await expect(api.listCashierMenuProducts()).resolves.toEqual([product]);
    const productUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(productUrl.pathname).toBe('/api/v1/merchant/products');
    expect(productUrl.searchParams.get('status')).toBe('ON_SALE');
  });

  it('uses the unified merchant item-ordering and adjustment contracts', async () => {
    const { api } = await loadApi();
    const mutationResult = { order, session: { ...session, status: 'OPEN', closedAt: null } };
    fetchMock
      .mockResolvedValueOnce(apiResponse(mutationResult))
      .mockResolvedValueOnce(apiResponse(mutationResult))
      .mockResolvedValueOnce(apiResponse(mutationResult));

    await expect(api.createMerchantTableOrder('table-1', {
      idempotencyKey: 'add-request-1',
      items: [{ productId: 'product-1', quantity: 2, remark: 'Less spicy' }],
    })).resolves.toEqual(mutationResult);
    await expect(api.decreaseMerchantOrderItem('order-1', 'item-1', {
      requestKey: 'decrease-request-1',
      expectedQuantity: 2,
      targetQuantity: 1,
    })).resolves.toEqual(mutationResult);
    await expect(api.returnMerchantOrderItem('order-1', 'item-1', {
      requestKey: 'return-request-1',
      expectedQuantity: 2,
      returnQuantity: 1,
    })).resolves.toEqual(mutationResult);

    expect(fetchMock.mock.calls.map(requestPath)).toEqual([
      '/api/v1/merchant/tables/table-1/orders',
      '/api/v1/merchant/orders/order-1/items/item-1/quantity',
      '/api/v1/merchant/orders/order-1/items/item-1/return',
    ]);
    expect(fetchMock.mock.calls.map((call) => requestInit(call).method)).toEqual([
      'POST',
      'PATCH',
      'POST',
    ]);
    expect(JSON.parse(String(requestInit(fetchMock.mock.calls[0]).body))).toEqual({
      idempotencyKey: 'add-request-1',
      items: [{ productId: 'product-1', quantity: 2, remark: 'Less spicy' }],
    });
  });

  it('supports an open-only table order with a null order in the API contract', async () => {
    const { api } = await loadApi();
    const openOnlyResult = {
      order: null,
      session: { ...session, status: 'OPEN', closedAt: null },
    };
    fetchMock.mockResolvedValueOnce(apiResponse(openOnlyResult));

    await expect(api.createMerchantTableOrder('table-1', {
      idempotencyKey: 'open-only-request-1',
      items: [],
    })).resolves.toEqual(openOnlyResult);
    expect(requestPath(fetchMock.mock.calls[0])).toBe('/api/v1/merchant/tables/table-1/orders');
    expect(requestInit(fetchMock.mock.calls[0]).method).toBe('POST');
    expect(JSON.parse(String(requestInit(fetchMock.mock.calls[0]).body))).toEqual({
      idempotencyKey: 'open-only-request-1',
      items: [],
    });
  });

  it('uses the API by default and fixtures only after explicit activation', async () => {
    const real = await loadApi('false');
    fetchMock.mockResolvedValueOnce(apiResponse([table]));
    await expect(real.api.listDiningTables()).resolves.toEqual([table]);
    expect(fetchMock).toHaveBeenCalledOnce();

    fetchMock.mockReset();
    const fixture = await loadApi('true');
    fetchMock.mockResolvedValueOnce(apiResponse([table]));
    await expect(fixture.api.listDiningTables()).resolves.toEqual([table]);
    expect(fetchMock).toHaveBeenCalledOnce();

    fetchMock.mockReset();
    fixture.fixtures.activateDemoSession();
    const demoTables = await fixture.api.listDiningTables();
    expect(demoTables.length).toBeGreaterThan(0);
    expect(demoTables[0]?.merchantId).toBe('demo-merchant');
    expect(fetchMock).not.toHaveBeenCalled();
    fixture.fixtures.deactivateDemoSession();
  });
});
