import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import KdsPage from './KdsPage.vue';
import { demoKds } from '@/features/kds/kds-demo';
import type { KdsBoard, KdsLine } from '@/features/kds/kds-types';
import { getKdsBoard, runKdsAction, saveKdsSettings } from '@/api/kds';
import { CashierApiError } from '@/api/error';
import { setLocale } from '@/i18n';
import { kdsText } from '@/features/kds/kds-text';

const testAuth = vi.hoisted(() => ({ role: 'OWNER', profile: null as null | {
  nameZh: string; nameVi: string; coverUrl: string; businessHours: Record<string, string[]>;
} }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ role: testAuth.role, profile: testAuth.profile, demoMode: false, session: { id: '1' }, merchant: { id: '1', nameZh: '测试门店' } }) }));
vi.mock('@/stores/sound', () => ({ useSoundStore: () => ({ enabled: false, notifyNewOrders: vi.fn(), resetMerchant: vi.fn(), enable: vi.fn(), disable: vi.fn() }) }));
vi.mock('@/api/kds', () => ({ getKdsBoard: vi.fn(), runKdsAction: vi.fn(), packKdsOrder: vi.fn(), saveKdsSettings: vi.fn(), undoKdsOperation: vi.fn() }));
let wrapper: VueWrapper;
let data: KdsBoard;
beforeEach(() => {
  vi.mocked(runKdsAction).mockReset().mockResolvedValue({ operationId: 'made', replay: false });
  testAuth.role = 'OWNER';
  testAuth.profile = null;
  data = demoKds.board();
  vi.mocked(getKdsBoard).mockImplementation(async () => JSON.parse(JSON.stringify(data)) as KdsBoard);
});
afterEach(() => { wrapper?.unmount(); setLocale('zh'); vi.clearAllMocks(); vi.restoreAllMocks(); });
async function open() {
  wrapper = mount(KdsPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
  await flushPromises();
}
async function button(text: string) {
  const found = wrapper.findAll('button').find(item => item.text() === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  await found.trigger('click'); await flushPromises();
}
describe('KDS operational controls', () => {
  it.each(['vi','en'] as const)('switches dish names and searches in %s across preparation, summary, serving, progress and records', async language => {
    const first=data.tasks[0]!;
    const translated={dishNameVi:'Thịt heo xào ớt',dishNameEn:'Pepper pork'};
    data.tasks.filter(task=>task.productId===first.productId).forEach(task=>Object.assign(task,translated));
    first.madeQuantity=1;
    data.operations=[{id:'translated-record',staffId:'1',kind:'MAKE',reversedAt:null,createdAt:data.serverTime,
      lines:[{taskId:first.id,orderId:first.orderId,dishName:first.dishName,...translated,quantity:1,orderType:'DINE_IN',tableNo:'01'}]}];
    await open(); await wrapper.get('.kds-order-card').trigger('click');
    await wrapper.get('.kds-detail-card input').setValue('1');
    setLocale(language); await flushPromises();
    const name=language==='vi'?translated.dishNameVi:translated.dishNameEn;
    expect(wrapper.get('.kds-order-card').text()).toContain(name);
    expect(wrapper.get('.kds-detail-card strong').text()).toBe(name);
    expect((wrapper.get('.kds-detail-card input').element as HTMLInputElement).value).toBe('1');
    expect(wrapper.get('.kds-detail').text()).toContain('烤牛肉串'); // Missing translation falls back to the snapshot.
    expect(runKdsAction).not.toHaveBeenCalled();
    await button(kdsText(language,'dishBump')); await wrapper.get('.kds-card').trigger('click');
    expect(wrapper.get('.kds-card > strong').text()).toBe(name);
    expect(wrapper.get('.kds-detail h2').text()).toContain(name);
    await button(kdsText(language,'serving')); await wrapper.get('.kds-serving-card').trigger('click');
    expect(wrapper.get('.kds-serving-card').text()).toContain(name);
    expect(wrapper.get('.kds-detail-card strong').text()).toBe(name);
    await button(kdsText(language,'orders')); await wrapper.get('.kds-order-card').trigger('click');
    expect(wrapper.get('.kds-order-card').text()).toContain(name);
    expect(wrapper.get('.kds-detail-card strong').text()).toBe(name);
    await button(kdsText(language,'records'));
    expect(wrapper.get('.kds-records').text()).toContain(name);
    await wrapper.get('.kds-search input').setValue(name);
    expect(wrapper.findAll('.kds-records article')).toHaveLength(1);
    await button(kdsText(language,'orderBump'));
    expect(wrapper.findAll('.kds-order-card')).toHaveLength(4);
    setLocale('zh'); await flushPromises();
    expect(wrapper.get('.kds-order-card').text()).toContain(first.dishName);
  });
  it('uses compressed dish images in preparation, serving and read-only details without repeated table or station headings', async () => {
    const first = data.tasks[0]!;
    first.menuThumbnailUrl = 'https://example.test/uploads/product-thumbnails/kds-menu.webp';
    first.madeQuantity = 1;
    await open(); await wrapper.get('.kds-order-card').trigger('click');
    const details = () => wrapper.get('.kds-detail');
    expect(details().find('h2').exists()).toBe(false);
    expect(details().find('.kds-scope-note').exists()).toBe(false);
    expect(details().get('.kds-detail-thumbnail img').attributes('src')).toBe(first.menuThumbnailUrl);
    await button('待传菜'); await wrapper.get('.kds-serving-card').trigger('click');
    expect(details().find('h2').exists()).toBe(false);
    expect(details().get('.kds-detail-thumbnail img').attributes('src')).toBe(first.menuThumbnailUrl);
    await button('订单进度'); await wrapper.get('.kds-order-card').trigger('click');
    expect(details().find('h2').exists()).toBe(false);
    expect(details().get('.kds-detail-thumbnail img').attributes('src')).toBe(first.menuThumbnailUrl);
    expect(details().findAll('button,input')).toHaveLength(0);
  });
  it('uses the cashier merchant profile and Vietnam date across midnight and language changes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-13T18:05:00Z'));
    testAuth.profile = { nameZh: '川味测试门店', nameVi: 'Quán thử nghiệm', coverUrl: 'https://example.test/store.jpg',
      businessHours: { wednesday: ['00:00-23:59'] } };
    await open();
    const identity = wrapper.get('[data-testid="cashier-merchant-panel"]');
    expect(identity.text()).toContain('川味测试门店');
    expect(identity.text()).toContain('营业中');
    expect(identity.get('img').attributes('src')).toBe('https://example.test/store.jpg');
    expect(wrapper.get('.kds-clock strong').text()).toBe('01:05');
    expect(wrapper.get('.kds-clock small').text()).toBe('10/14周三');
    setLocale('vi'); await flushPromises();
    expect(identity.text()).toContain('Quán thử nghiệm');
    expect(wrapper.get('.kds-clock small').text()).toContain('14/10');
  });
  it('lets staff select a local language in settings without exposing merchant configuration or saving it to the API', async () => {
    testAuth.role = 'CASHIER';
    await open();
    await wrapper.get('button[aria-label="厨显设置"]').trigger('click');
    expect(wrapper.find('.kds-settings-fields').exists()).toBe(false);
    expect(wrapper.find('.kds-dialog footer .kds-primary').exists()).toBe(false);
    await wrapper.get('select[aria-label="语言"]').setValue('vi');
    expect(wrapper.get('.kds-dialog').text()).toContain('Ngôn ngữ');
    expect(saveKdsSettings).not.toHaveBeenCalled();
    await button('Đóng');
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
  });
  it.each([-3600000, 3600000])('renders a newly sent order without an overdue badge when the device clock differs by %i ms', offset => {
    const server = Date.parse(data.serverTime);
    vi.spyOn(Date, 'now').mockReturnValue(server + offset);
    data.tasks.forEach(task => { task.createdAt = new Date(server - 10000).toISOString(); });
    return open().then(() => {
      expect(wrapper.findAll('.kds-order-card.overdue')).toHaveLength(0);
      expect(wrapper.get('.kds-order-card header small').text()).toBe('已等 0 分钟');
    });
  });
  it('immediately submits 2 portions to table 01 only, then shows 1 remaining', async () => {
    vi.mocked(runKdsAction).mockImplementation(async (_action, lines: KdsLine[]) => {
      for (const line of lines) {
        const task = data.tasks.find(row => row.id === line.taskId)!; task.madeQuantity += line.quantity; task.version++;
      }
      return { operationId: 'made', replay: false };
    });
    await open(); await button('汇总划菜'); await wrapper.get('.kds-card').trigger('click');
    await wrapper.get('input[aria-label="01 桌 本次数量"]').setValue('2');
    await button('部分划菜');
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    expect(wrapper.find('.kds-notice').exists()).toBe(false);
    expect(runKdsAction).toHaveBeenCalledWith('MAKE', [{ taskId: data.tasks[0]!.id, version: 1, quantity: 2 }], expect.any(String));
    expect(wrapper.get('input[aria-label="01 桌 本次数量"]').element.getAttribute('max')).toBe('1');
    expect(wrapper.get('.kds-stats').text()).toContain('22');
  });
  it('locks write controls while a batch is being submitted', async () => {
    let resolve!: (value: { operationId: string; replay: boolean }) => void;
    vi.mocked(runKdsAction).mockReturnValue(new Promise(done => { resolve = done; }));
    await open(); await button('汇总划菜'); await wrapper.get('.kds-card').trigger('click'); await button('全部划菜');
    const bumpButton = wrapper.get('.kds-detail-actions button');
    await bumpButton.trigger('click'); await bumpButton.trigger('click');
    expect(bumpButton.attributes('disabled')).toBeDefined(); expect(runKdsAction).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    resolve({ operationId: 'made', replay: false }); await flushPromises();
  });
  it('keeps order progress read-only and leaves unmade pickup dishes out of the serving queue', async () => {
    await open(); await button('订单进度');
    const pickup = wrapper.findAll('.kds-order-card').find(item => item.text().includes('#1038'))!;
    await pickup.trigger('click'); await flushPromises();
    expect(wrapper.get('.kds-detail').findAll('button,input')).toHaveLength(0);
    expect(wrapper.find('.kds-fulfillment-link').exists()).toBe(false);
    expect(wrapper.get('.kds-detail').text()).not.toContain('演示顾客');
    expect(wrapper.findAll('button').some(button => button.text() === '撤销上次划菜')).toBe(false);
    await button('待传菜');
    expect(wrapper.findAll('.kds-serving-card')).toHaveLength(0);
    expect(runKdsAction).not.toHaveBeenCalled();
  });
  it('preserves the last board but disables writes after connection loss', async () => {
    await open(); await wrapper.get('.kds-bump-orders .kds-order-card').trigger('click');
    vi.mocked(getKdsBoard).mockRejectedValueOnce(new Error('offline'));
    const refreshButton = wrapper.get('button[aria-label="刷新"]'); await refreshButton.trigger('click'); await flushPromises();
    expect(wrapper.get('[role=alert]').text()).toContain('连接中断');
    expect(wrapper.get('.kds-detail-actions > div:last-child button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.kds-detail-actions .kds-primary').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('.kds-order-card').length).toBeGreaterThan(0);
  });
  it('keeps station and order type independent from the two bump modes', async () => {
    await open(); await wrapper.get('select[aria-label="档口"]').setValue('烧烤档'); await button('堂食');
    await button('汇总划菜');
    expect((wrapper.get('select[aria-label="档口"]').element as HTMLSelectElement).value).toBe('烧烤档');
    expect(wrapper.findAll('.kds-badges .PICKUP').every(badge => !badge.isVisible())).toBe(true);
    await button('标准划菜');
    expect((wrapper.get('select[aria-label="档口"]').element as HTMLSelectElement).value).toBe('烧烤档');
    expect(wrapper.findAll('.kds-order-card')).toHaveLength(2);
    expect(wrapper.find('.kds-nav').text()).not.toMatch(/串烤划菜|粉面划菜|待制作/);
  });
  it('bumps the whole table in the chosen station, including dishes beyond the search match', async () => {
    const first = data.tasks[0]!;
    data.tasks.push({ ...first, id: 'bar', orderItemId: 'bar-item', dishName: '茶饮', station: '吧台', quantity: 1 });
    const items = [...first.order.items, { id: 'bar-item', quantity: 1, productNameZhSnapshot: '茶饮' }];
    data.tasks.filter(task => task.orderId === first.orderId).forEach(task => { task.order = { ...task.order, items }; });
    vi.mocked(runKdsAction).mockImplementation(async (_action, lines) => {
      lines.forEach(line => { const row = data.tasks.find(task => task.id === line.taskId)!; row.madeQuantity += line.quantity; row.version++; });
      return { operationId: 'made', replay: false };
    });
    await open(); await wrapper.get('select[aria-label="档口"]').setValue('烧烤档');
    await wrapper.get('.kds-search input').setValue('烤羊肉串');
    const table = wrapper.findAll('.kds-order-card').find(card => card.text().includes('01 桌'))!;
    expect(table.text()).toContain('烤牛肉串');
    await table.trigger('click'); await button('整桌划菜');
    const expected = data.tasks.filter(task => task.orderId === '1' && task.station === '烧烤档')
      .map(task => ({ taskId: task.id, version: 1, quantity: task.quantity }));
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    expect(runKdsAction).toHaveBeenCalledWith('MAKE', expected, expect.any(String));
    expect(data.tasks.find(task => task.id === 'bar')!.madeQuantity).toBe(0);
    expect(data.tasks.find(task => task.orderId === '2')!.madeQuantity).toBe(0);
    expect(wrapper.get('.kds-detail').text()).toContain('本档口已完成');
    expect(wrapper.get('.kds-detail').text()).toContain('其他档口尚未出齐');
  });
  it('uses the same partial progress in both modes and offers a single-dish bump', async () => {
    vi.mocked(runKdsAction).mockImplementation(async (_action, lines) => {
      lines.forEach(line => { const row = data.tasks.find(task => task.id === line.taskId)!; row.madeQuantity += line.quantity; row.version++; });
      return { operationId: 'made', replay: false };
    });
    await open(); await wrapper.get('.kds-order-card').trigger('click');
    await wrapper.get('input[aria-label="烤羊肉串 · 01 桌 本次数量"]').setValue('2');
    await button('部分划菜');
    await button('汇总划菜'); await wrapper.get('.kds-card').trigger('click');
    expect(wrapper.get('input[aria-label="01 桌 本次数量"]').attributes('max')).toBe('1');
    await button('标准划菜'); await wrapper.get('.kds-order-card').trigger('click');
    await wrapper.get('button[aria-label="单菜划完 烤羊肉串 · 01 桌"]').trigger('click');
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    expect(vi.mocked(runKdsAction).mock.calls[1]![1]).toEqual([{ taskId: data.tasks[0]!.id, version: 2, quantity: 1 }]);
  });
  it('groups additions from one dining session and freezes the batch before later additions arrive', async () => {
    const first = data.tasks[0]!;
    const addition = { ...first, id: 'added', orderId: 'added-order', orderItemId: 'added-item', dishName: '加菜鸡翅', quantity: 1,
      order: { ...first.order, id: 'added-order', orderNo: 'ADDED-01', items: [{ id: 'added-item', quantity: 1, productNameZhSnapshot: '加菜鸡翅' }] } };
    data.tasks.push(addition);
    await open();
    expect(wrapper.findAll('.kds-order-card').filter(card => card.text().includes('01 桌'))).toHaveLength(1);
    const table = wrapper.findAll('.kds-order-card').find(card => card.text().includes('01 桌'))!;
    await table.trigger('click'); await button('整桌划菜');
    const originalCount = vi.mocked(runKdsAction).mock.calls[0]![1].length;
    data.tasks.push({ ...addition, id: 'later', orderItemId: 'later-item', dishName: '稍后加菜' });
    await wrapper.get('button[aria-label="刷新"]').trigger('click'); await flushPromises();
    expect(vi.mocked(runKdsAction).mock.calls[0]![1]).toHaveLength(originalCount);
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    const lines = vi.mocked(runKdsAction).mock.calls[0]![1];
    expect(lines.some(line => line.taskId === 'added')).toBe(true);
    expect(lines.some(line => line.taskId === 'later')).toBe(false);
  });
  it('serves only prepared portions in the selected station and keeps the full progress visible', async () => {
    const pickup = data.tasks.find(task => task.order.orderType === 'PICKUP')!;
    data.tasks.filter(task => task.orderId === pickup.orderId).forEach(task => { task.madeQuantity = task.quantity; });
    const bar = { ...pickup, id: 'bar-pickup', orderItemId: 'bar-item', dishName: '茶饮', station: '吧台', quantity: 1, madeQuantity: 0 };
    data.tasks.push(bar);
    const items = [...pickup.order.items, { id: 'bar-item', quantity: 1, productNameZhSnapshot: '茶饮' }];
    data.tasks.filter(task => task.orderId === pickup.orderId).forEach(task => { task.order = { ...task.order, items }; });
    await open(); await wrapper.get('select[aria-label="档口"]').setValue('烧烤档'); await button('待传菜');
    await wrapper.get('[data-order-type="PICKUP"] .kds-serving-card').trigger('click');
    expect(wrapper.get('.kds-detail').text()).not.toContain('茶饮');
    const expected = data.tasks.filter(task => task.orderId === pickup.orderId && task.station === '烧烤档')
      .map(task => ({ taskId: task.id, version: task.version, quantity: task.madeQuantity }));
    await button('全部传菜');
    expect(runKdsAction).toHaveBeenCalledWith('SERVE', expected, expect.any(String));
    expect(bar.servedQuantity).toBe(0);
    await button('订单进度');
    await wrapper.get('[data-order-type="PICKUP"] .kds-order-card').trigger('click');
    expect(wrapper.get('.kds-detail').text()).toContain('茶饮');
    expect(wrapper.get('[data-order-type="PICKUP"] .kds-order-card.selected').text()).toContain('制作中');
    expect(wrapper.get('.kds-detail').findAll('button,input')).toHaveLength(0);
  });
  it('serves prepared pickup portions immediately and waits for the rest of the order', async () => {
    const pickup = data.tasks.find(task => task.order.orderType === 'PICKUP')!;
    pickup.madeQuantity = 1;
    vi.mocked(runKdsAction).mockImplementation(async (action, lines) => {
      expect(action).toBe('SERVE');
      lines.forEach(line => { const row = data.tasks.find(task => task.id === line.taskId)!; row.servedQuantity += line.quantity; row.version++; });
      return { operationId: 'served', replay: false };
    });
    await open(); await button('待传菜');
    await wrapper.get('[data-order-type="PICKUP"] .kds-serving-card').trigger('click');
    await wrapper.get(`button[aria-label="单菜传完 ${pickup.dishName} · #${pickup.order.pickupCode ?? pickup.order.orderNo}"]`).trigger('click');
    await flushPromises();
    expect(runKdsAction).toHaveBeenCalledWith('SERVE', [{ taskId: pickup.id, version: 1, quantity: 1 }], expect.any(String));
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    expect(wrapper.find('.kds-notice').exists()).toBe(false);
    expect(wrapper.findAll('.kds-serving-card')).toHaveLength(0);
  });
  it('retries an uncertain batch using the frozen payload and key even after new dishes arrive', async () => {
    vi.mocked(runKdsAction).mockRejectedValueOnce(new CashierApiError({ message: 'timeout', code: 'REQUEST_ABORTED' }));
    await open(); await wrapper.get('.kds-order-card').trigger('click'); await button('整桌划菜');
    const first = vi.mocked(runKdsAction).mock.calls[0]!;
    expect(wrapper.get('[role=alert]').text()).toContain('操作结果待确认');
    expect(wrapper.get('.kds-detail-actions > div:last-child button').attributes('disabled')).toBeDefined();
    const row = data.tasks[0]!;
    data.tasks.push({ ...row, id: 'later', orderItemId: 'later-item', dishName: '新加菜' });
    await wrapper.get('button[aria-label="刷新"]').trigger('click'); await flushPromises();
    await button('重试本次操作');
    expect(vi.mocked(runKdsAction).mock.calls[1]).toEqual(first);
    expect(wrapper.find('[role=alert]').exists()).toBe(false);
    expect(wrapper.find('.kds-notice').exists()).toBe(false);
  });
  it('releases a rejected batch after a definitive conflict and displays the failure', async () => {
    vi.mocked(runKdsAction).mockRejectedValueOnce(new CashierApiError({ message: '数量已变化', status: 409 }));
    await open(); await wrapper.get('.kds-order-card').trigger('click'); await button('整桌划菜');
    expect(wrapper.get('[role=alert]').text()).toContain('数量已变化');
    expect(wrapper.findAll('button').some(item => item.text() === '重试本次操作')).toBe(false);
    expect(wrapper.get('.kds-detail-actions > div:last-child button').attributes('disabled')).toBeUndefined();
  });
  it('splits mixed-operation lines into the correct source lanes and removes the unused detail pane', async () => {
    data.operations = [{ id: 'mixed', kind: 'MAKE', staffId: '1', reversedAt: null, createdAt: data.serverTime,
      lines: data.tasks.slice(0, 4).map(task => ({ taskId: task.id, orderId: task.orderId, dishName: task.dishName,
        quantity: 1, orderType: task.order.orderType, orderNo: task.order.orderNo, tableNo: task.order.tableNo, station: task.station })) }];
    await open(); await button('划菜记录');
    expect(wrapper.find('.kds-detail').exists()).toBe(false);
    expect(wrapper.findAll('.kds-record-lanes .kds-lane')).toHaveLength(3);
    expect(wrapper.get('[data-order-type="DINE_IN"]').findAll('.kds-records p')).toHaveLength(2);
    expect(wrapper.get('[data-order-type="PICKUP"]').text()).toContain('#DEMO-1038');
    expect(wrapper.get('[data-order-type="DELIVERY"]').text()).toContain('#DEMO-2026');
    await wrapper.get('.kds-types button:nth-child(2)').trigger('click');
    expect(wrapper.findAll('.kds-record-lanes .kds-lane')).toHaveLength(1);
    expect(wrapper.findAll('.kds-records p')).toHaveLength(2);
    expect(wrapper.get('.kds-workspace').text()).not.toContain('#DEMO-1038');
  });

  it('shows made-but-unserved quantities and excludes cancelled or handed-off work', async () => {
    const first = data.tasks[0]!; first.madeQuantity = 2; first.servedQuantity = 1;
    const second = data.tasks[1]!; second.madeQuantity = 1; second.order.status = 'CANCELLED';
    const pickup = data.tasks.find(task => task.order.orderType === 'PICKUP')!; pickup.madeQuantity = 1; pickup.order.status = 'READY';
    await open(); await button('待传菜');
    expect(wrapper.findAll('.kds-serving-card')).toHaveLength(1);
    const card = wrapper.get('.kds-serving-card'); expect(card.text()).toContain('01 桌');
    expect(card.text()).toContain('待传菜 1 份');
    await card.trigger('click');
    expect(wrapper.findAll('.kds-detail-card')).toHaveLength(1);
    expect(wrapper.get('.kds-serving-count').text()).toBe('待传菜 1 份');
    expect(wrapper.get('input[aria-label="烤羊肉串 · 01 桌 传菜数量"]').attributes('max')).toBe('1');
  });
  it('serves two portions immediately, preserves another table, and leaves one in the ready queue', async () => {
    const first = data.tasks[0]!; first.madeQuantity = 3;
    const second = data.tasks[1]!; second.madeQuantity = 2;
    vi.mocked(runKdsAction).mockImplementation(async (_action, lines) => {
      lines.forEach(line => { const task = data.tasks.find(task => task.id === line.taskId)!; task.servedQuantity += line.quantity; task.version++; });
      return { operationId: 'served', replay: false };
    });
    await open(); await button('待传菜');
    await wrapper.findAll('.kds-serving-card').find(card => card.text().includes('01 桌'))!.trigger('click');
    await wrapper.get('input[aria-label="烤羊肉串 · 01 桌 传菜数量"]').setValue('2');
    await button('部分传菜');
    expect(runKdsAction).toHaveBeenCalledWith('SERVE', [{ taskId: first.id, version: 1, quantity: 2 }], expect.any(String));
    expect(first.madeQuantity).toBe(3); expect(first.servedQuantity).toBe(2); expect(second.servedQuantity).toBe(0);
    expect(wrapper.get('.kds-serving-count').text()).toBe('待传菜 1 份');
    expect(wrapper.find('[role=dialog]').exists()).toBe(false); expect(wrapper.find('.kds-notice').exists()).toBe(false);
    await button('订单进度');
    await wrapper.get('[data-order-type="DINE_IN"] .kds-order-card').trigger('click');
    expect(wrapper.get('.kds-detail').text()).toContain('已完成 3 / 3 · 已传出 2');
    expect(wrapper.get('.kds-detail').findAll('button,input')).toHaveLength(0);
  });
  it('groups the ready dishes of the same dining session but keeps original task IDs in a whole batch', async () => {
    const first = data.tasks[0]!; first.madeQuantity = 2;
    const added = { ...first, id: 'add-ready', orderId: 'add-order', orderItemId: 'add-item', dishName: '加菜鸡翅', quantity: 1, madeQuantity: 1,
      order: { ...first.order, id: 'add-order', orderNo: 'ADDED-01', items: [{ id: 'add-item', quantity: 1, productNameZhSnapshot: '加菜鸡翅' }] } };
    const bar = { ...first, id: 'bar-ready', orderItemId: 'bar-item', station: '吧台', dishName: '茶饮', quantity: 1, madeQuantity: 1 };
    data.tasks.push(added, bar);
    await open(); await wrapper.get('select[aria-label="档口"]').setValue('烧烤档');
    await wrapper.get('.kds-search input').setValue('烤羊肉串'); await button('待传菜');
    expect(wrapper.findAll('.kds-serving-card')).toHaveLength(1);
    expect(wrapper.get('.kds-serving-card').text()).toContain('加菜鸡翅');
    await wrapper.get('.kds-serving-card').trigger('click'); await button('全部传菜');
    expect(runKdsAction).toHaveBeenCalledWith('SERVE', [{ taskId: first.id, version: 1, quantity: 2 },
      { taskId: added.id, version: 1, quantity: 1 }], expect.any(String));
    expect(bar.servedQuantity).toBe(0);
  });
  it('jumps from a prepared table into its serving card', async () => {
    data.tasks[0]!.madeQuantity = 2;
    await open(); await wrapper.get('.kds-search input').setValue('烤牛肉串');
    await wrapper.findAll('.kds-bump-orders .kds-order-card').find(card => card.text().includes('01 桌'))!.trigger('click');
    await wrapper.get('.kds-detail-summary button').trigger('click');
    expect(wrapper.get('.kds-nav button[aria-label="待传菜"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.kds-detail h2').exists()).toBe(false);
    expect(wrapper.get('.kds-serving-card.selected').text()).toContain('01 桌');
    expect(wrapper.get('.kds-serving-count').text()).toBe('待传菜 2 份');
    expect((wrapper.get('.kds-search input').element as HTMLInputElement).value).toBe('');
  });
  it('locks serving buttons during a write and replays an uncertain serving batch with the same key', async () => {
    data.tasks[0]!.madeQuantity = 2;
    let reject!: (error: Error) => void;
    vi.mocked(runKdsAction).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    await open(); await button('待传菜'); await wrapper.get('.kds-serving-card').trigger('click'); await button('全部传菜');
    const send = wrapper.get('.kds-detail-actions button');
    await send.trigger('click'); expect(runKdsAction).toHaveBeenCalledTimes(1); expect(send.attributes('disabled')).toBeDefined();
    reject(new CashierApiError({ message: 'timeout', code: 'REQUEST_ABORTED' })); await flushPromises();
    const first = vi.mocked(runKdsAction).mock.calls[0]!;
    data.tasks[1]!.madeQuantity = 2;
    await wrapper.get('button[aria-label="刷新"]').trigger('click'); await flushPromises();
    expect(wrapper.get('.kds-detail-actions button').attributes('disabled')).toBeDefined();
    await button('重试本次操作'); expect(vi.mocked(runKdsAction).mock.calls[1]).toEqual(first);
    expect(wrapper.find('.kds-notice').exists()).toBe(false);
  });

});
