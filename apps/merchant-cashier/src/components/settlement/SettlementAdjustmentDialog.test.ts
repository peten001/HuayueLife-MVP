import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import SettlementAdjustmentDialog from './SettlementAdjustmentDialog.vue';

function mountDialog(extraProps: Record<string, unknown> = {}) {
  return mount(SettlementAdjustmentDialog, {
    props: {
      open: true,
      itemAmountVnd: '1000000',
      nonDiscountableFeeVnd: '30000',
      discountPayableRateBps: null,
      roundingEnabled: false,
      showDeliveryFee: true,
      ...extraProps,
    },
  });
}

describe('SettlementAdjustmentDialog', () => {
  afterEach(() => setLocale('zh'));

  it.each([
    ['10', null],
    ['9', 9000],
    ['8.5', 8500],
  ])('submits %s 折 as the expected bps value', async (value, expected) => {
    const wrapper = mountDialog();
    await wrapper.get('input[inputmode="decimal"]').setValue(value);
    await wrapper.get('[data-testid="discount-confirm"]').trigger('click');

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      discountPayableRateBps: expected,
      roundingEnabled: false,
    });
  });

  it('previews discount before delivery fee and rounding with the corrected delivery result', async () => {
    const wrapper = mountDialog();
    await wrapper.get('input[inputmode="decimal"]').setValue('9');
    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(wrapper.text()).toContain('100,000');
    expect(wrapper.text()).toContain('30,000');
    expect(wrapper.text()).toContain('930,000');
    expect(wrapper.text()).not.toContain('-10,000');
  });

  it.each(['10.001', '10.01', '11', '-1', 'abc'])('rejects invalid rate %s', async (value) => {
    const wrapper = mountDialog();
    await wrapper.get('input[inputmode="decimal"]').setValue(value);

    expect(wrapper.get('[data-testid="discount-confirm"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="discount-confirm"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('initializes the rounding switch and only cancels without saving', async () => {
    const wrapper = mountDialog({ discountPayableRateBps: 9250, roundingEnabled: true });
    expect((wrapper.get('input[inputmode="decimal"]').element as HTMLInputElement).value).toBe('9.25');
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);

    await wrapper.get('[data-testid="discount-cancel"]').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('renders the switch and orders cancel, clear and confirm actions explicitly', () => {
    const wrapper = mountDialog({ discountPayableRateBps: 9000, roundingEnabled: true });
    expect(wrapper.get('input[type="checkbox"]').attributes('role')).toBe('switch');
    expect(wrapper.find('.settlement-adjustment-dialog__switch-track').exists()).toBe(true);
    expect(wrapper.findAll('footer button').map((button) => button.text())).toEqual([
      '取消',
      '清除优惠',
      '确认优惠',
    ]);
  });

  it('renders the dark compact structure without icon or helper copy', () => {
    const wrapper = mountDialog({
      itemAmountVnd: '1541000',
      nonDiscountableFeeVnd: '0',
      discountPayableRateBps: 9500,
      roundingEnabled: true,
      showDeliveryFee: false,
    });
    const dialog = wrapper.get('.settlement-adjustment-dialog');
    const controls = wrapper.get('[data-testid="discount-controls"]');

    expect(dialog.classes()).toContain('settlement-adjustment-dialog--dark');
    expect(wrapper.get('.dialog-backdrop').classes()).toContain('settlement-adjustment-dialog-backdrop');
    expect(wrapper.find('.settlement-adjustment-dialog__icon').exists()).toBe(false);
    expect(wrapper.find('header p').exists()).toBe(false);
    expect(controls.findAll('.settlement-adjustment-dialog__control-label').map((label) => label.text())).toEqual([
      '整单折扣',
      '抹零',
    ]);
    expect(controls.element.children).toHaveLength(4);
    expect(Array.from(controls.element.children).map((element) => element.className)).toEqual([
      'settlement-adjustment-dialog__control-label',
      'settlement-adjustment-dialog__rate-input',
      'settlement-adjustment-dialog__control-label',
      'settlement-adjustment-dialog__switch',
    ]);
    expect(controls.find('.settlement-adjustment-dialog__rate-input').exists()).toBe(true);
    expect(controls.find('.settlement-adjustment-dialog__switch').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('设置整单折扣和抹零');
    expect(wrapper.text()).not.toContain('10折为无折扣');
    expect(wrapper.text()).not.toContain('向下取整到整万');
  });

  it('uses compact dialog-only amount labels and preserves complete values', () => {
    const wrapper = mountDialog({
      itemAmountVnd: '1541000',
      nonDiscountableFeeVnd: '0',
      discountPayableRateBps: 9500,
      roundingEnabled: true,
      showDeliveryFee: false,
    });

    expect(wrapper.findAll('.settlement-adjustment-dialog__summary dt').map((label) => label.text())).toEqual([
      '原金额',
      '折扣',
      '抹零',
      '实收',
    ]);
    expect(wrapper.findAll('.settlement-adjustment-dialog__summary dd').map((amount) => amount.text())).toEqual([
      '1,541,000 VND',
      '-77,050 VND',
      '-3,950 VND',
      '1,460,000 VND',
    ]);
    expect(wrapper.text()).not.toContain('商品原金额');
    expect(wrapper.text()).not.toContain('折扣优惠');
    expect(wrapper.text()).not.toContain('抹零金额');
    expect(wrapper.text()).not.toContain('最终应收');
  });

  it('clears the persisted discount and rounding through the existing confirm contract', async () => {
    const wrapper = mountDialog({ discountPayableRateBps: 9000, roundingEnabled: true });
    await wrapper.get('input[inputmode="decimal"]').setValue('8.5');
    await wrapper.get('input[type="checkbox"]').setValue(false);
    await wrapper.get('[data-testid="discount-clear"]').trigger('click');

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      discountPayableRateBps: null,
      roundingEnabled: false,
    });
  });

  it('disables clear without a persisted adjustment regardless of unsaved draft changes', async () => {
    const wrapper = mountDialog();
    const clear = wrapper.get('[data-testid="discount-clear"]');
    expect(clear.attributes('disabled')).toBeDefined();

    await wrapper.get('input[inputmode="decimal"]').setValue('8.5');
    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(clear.attributes('disabled')).toBeDefined();
    await clear.trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('blocks clear, confirm and cancel while an adjustment request is loading', async () => {
    const wrapper = mountDialog({
      discountPayableRateBps: 9000,
      roundingEnabled: true,
      loading: true,
    });

    expect(wrapper.get('[data-testid="discount-cancel"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="discount-clear"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="discount-confirm"]').attributes('disabled')).toBeDefined();
    await wrapper.get('.dialog-backdrop').trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });
});
