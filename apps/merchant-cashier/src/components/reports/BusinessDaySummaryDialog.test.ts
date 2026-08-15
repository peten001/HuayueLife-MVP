import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import BusinessDaySummaryDialog from './BusinessDaySummaryDialog.vue';

const summary = {
  merchant: { id: '7', nameZh: '匿名回归店', nameVi: null },
  businessDate: '2026-08-15',
  segments: [{ start: '15:00', end: '01:00', crossesMidnight: true }],
  orderCount: 3,
  itemSummary: [{ nameZh: '匿名菜品', nameVi: null, nameEn: null, quantity: 2 }],
  discountAmountVnd: '0',
  roundingAmountVnd: '0',
  totalRevenueVnd: '300000',
  cashRevenueVnd: '300000',
  bankTransferRevenueVnd: '0',
  unrecordedRevenueVnd: '0',
  generatedAt: '2026-08-15T12:00:00.000Z',
};

function mountDialog(extraProps: Record<string, unknown> = {}) {
  return mount(BusinessDaySummaryDialog, {
    attachTo: document.body,
    props: {
      open: true,
      businessDate: '2026-08-15',
      summary,
      ...extraProps,
    },
  });
}

describe('BusinessDaySummaryDialog', () => {
  afterEach(() => {
    setLocale('zh');
    document.body.innerHTML = '';
  });

  it('renders a dedicated cancel and print action in the sticky footer', () => {
    const wrapper = mountDialog();
    const cancel = wrapper.get('footer .secondary-action');
    const print = wrapper.get('footer .primary-action');
    expect(cancel.element.tagName).toBe('BUTTON');
    expect(print.element.tagName).toBe('BUTTON');
    expect(cancel.element.getAttribute('disabled')).toBeNull();
    wrapper.unmount();
  });

  it('emits cancel on Escape and keeps printing disabled while loading', async () => {
    const wrapper = mountDialog({ loading: true });
    await window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('cancel')).toHaveLength(1);

    const print = wrapper.get('footer .primary-action');
    expect(print.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('renders the cross-midnight segment with the next-day marker', () => {
    const wrapper = mountDialog();
    expect(wrapper.text()).toContain('15:00');
    expect(wrapper.text()).toContain('次日');
    wrapper.unmount();
  });

  it('shows a single bilingual line with Vietnamese first in any locale', () => {
    const wrapper = mountDialog({
      summary: {
        ...summary,
        itemSummary: [
          { nameZh: '招牌牛肉锅', nameVi: 'Nồi bò đặc sản', nameEn: null, quantity: 18 },
        ],
      },
    });
    const row = wrapper.get('.summary-item');
    expect(row.text()).toContain('Nồi bò đặc sản 招牌牛肉锅');
    expect(row.text()).toContain('× 18');
    expect(row.find('.summary-item__name').text()).toBe('Nồi bò đặc sản 招牌牛肉锅');
    wrapper.unmount();
  });

  it('falls back to Chinese-only when the Vietnamese name is missing', () => {
    setLocale('vi');
    const wrapper = mountDialog({
      summary: {
        ...summary,
        itemSummary: [
          { nameZh: '历史删除菜品', nameVi: null, nameEn: null, quantity: 1 },
        ],
      },
    });
    const row = wrapper.get('.summary-item');
    expect(row.text()).toContain('历史删除菜品');
    expect(row.text()).not.toContain('undefined');
    expect(row.text()).not.toContain('null');
    expect(row.text()).not.toContain('/');
    expect(row.text()).not.toContain('× 0');
    wrapper.unmount();
  });

  it('does not duplicate a Vietnamese name identical to the Chinese name', () => {
    const wrapper = mountDialog({
      summary: {
        ...summary,
        itemSummary: [
          { nameZh: 'Bánh mì', nameVi: 'Bánh mì', nameEn: null, quantity: 3 },
        ],
      },
    });
    expect(wrapper.get('.summary-item__name').text()).toBe('Bánh mì');
    wrapper.unmount();
  });
});
