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
      discountAmountVnd: '0',
      roundingEnabled: false,
      showDeliveryFee: true,
      ...extraProps,
    },
  });
}

describe('SettlementAdjustmentDialog', () => {
  afterEach(() => setLocale('zh'));

  it.each([
    ['0', null],
    ['10', 9000],
    ['15', 8500],
  ])('submits %s%% as the expected payable bps value', async (value, expected) => {
    const wrapper = mountDialog();
    await wrapper.get('#discount-value-input').setValue(value);
    await wrapper.get('[data-testid="discount-confirm"]').trigger('click');

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      discountPayableRateBps: expected,
      roundingEnabled: false,
    });
  });

  it('submits an exact fixed VND discount without converting it to a rate', async () => {
    const wrapper = mountDialog({ itemAmountVnd: '316000', nonDiscountableFeeVnd: '0' });
    await wrapper.get('[data-testid="discount-mode-amount"]').trigger('click');
    await wrapper.get('#discount-value-input').setValue('16000');
    await wrapper.get('[data-testid="discount-confirm"]').trigger('click');

    expect((wrapper.get('#discount-value-input').element as HTMLInputElement).value).toBe('16,000');
    expect(wrapper.text()).toContain('-16,000 VND');
    expect(wrapper.text()).toContain('300,000 VND');
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      discountPayableRateBps: null,
      discountAmountVnd: '16000',
      roundingEnabled: false,
    });
  });

  it('previews percentage discount before delivery fee and rounding', async () => {
    const wrapper = mountDialog();
    await wrapper.get('#discount-value-input').setValue('10');
    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(wrapper.text()).toContain('-100,000 VND');
    expect(wrapper.text()).toContain('30,000 VND');
    expect(wrapper.text()).toContain('930,000 VND');
    expect(wrapper.text()).not.toContain('-10,000 VND');
  });

  it.each(['100.01', '101', '-1', 'abc'])('rejects invalid percentage %s', async (value) => {
    const wrapper = mountDialog();
    await wrapper.get('#discount-value-input').setValue(value);

    expect(wrapper.get('[data-testid="discount-confirm"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="discount-confirm"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('rejects a fixed amount above the original item amount with a corrective message', async () => {
    const wrapper = mountDialog({ itemAmountVnd: '316000' });
    await wrapper.get('[data-testid="discount-mode-amount"]').trigger('click');
    await wrapper.get('#discount-value-input').setValue('316001');

    expect(wrapper.text()).toContain('减免金额不能超过商品原金额');
    expect(wrapper.get('[data-testid="discount-confirm"]').attributes('disabled')).toBeDefined();
  });

  it('reopens a persisted fixed discount in VND mode', () => {
    const wrapper = mountDialog({
      itemAmountVnd: '316000',
      discountPayableRateBps: null,
      discountAmountVnd: '16000',
      roundingEnabled: true,
    });

    expect(wrapper.get('[data-testid="discount-mode-amount"]').attributes('aria-pressed')).toBe('true');
    expect((wrapper.get('#discount-value-input').element as HTMLInputElement).value).toBe('16,000');
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);
  });

  it('reopens a persisted rate as a discount percentage', () => {
    const wrapper = mountDialog({ discountPayableRateBps: 9250, discountAmountVnd: '75000' });
    expect(wrapper.get('[data-testid="discount-mode-percentage"]').attributes('aria-pressed')).toBe('true');
    expect((wrapper.get('#discount-value-input').element as HTMLInputElement).value).toBe('7.5');
  });

  it('renders compact controls, exact summary values and action order', () => {
    const wrapper = mountDialog({
      itemAmountVnd: '1541000',
      nonDiscountableFeeVnd: '0',
      discountPayableRateBps: 9500,
      discountAmountVnd: '77050',
      roundingEnabled: true,
      showDeliveryFee: false,
    });

    expect(wrapper.get('.settlement-adjustment-dialog').classes()).toContain('settlement-adjustment-dialog--dark');
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
    expect(wrapper.findAll('footer button').map((button) => button.text())).toEqual([
      '清除优惠',
      '取消',
      '确认优惠',
    ]);
  });

  it('clears a persisted fixed discount and rounding through the compatible contract', async () => {
    const wrapper = mountDialog({
      discountPayableRateBps: null,
      discountAmountVnd: '16000',
      roundingEnabled: true,
    });
    await wrapper.get('[data-testid="discount-clear"]').trigger('click');

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      discountPayableRateBps: null,
      roundingEnabled: false,
    });
  });

  it('keeps clear available for a legacy percentage response without an amount field', async () => {
    const wrapper = mountDialog({
      discountPayableRateBps: 9000,
      discountAmountVnd: undefined,
    });

    expect(wrapper.get('[data-testid="discount-clear"]').attributes('disabled')).toBeUndefined();
  });

  it('disables clear without a persisted adjustment regardless of unsaved draft changes', async () => {
    const wrapper = mountDialog();
    const clear = wrapper.get('[data-testid="discount-clear"]');
    expect(clear.attributes('disabled')).toBeDefined();

    await wrapper.get('#discount-value-input').setValue('15');
    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(clear.attributes('disabled')).toBeDefined();
    await clear.trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('blocks every action while an adjustment request is loading', async () => {
    const wrapper = mountDialog({
      discountPayableRateBps: 9000,
      discountAmountVnd: '100000',
      roundingEnabled: true,
      loading: true,
    });

    expect(wrapper.get('.settlement-adjustment-dialog__close').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="discount-cancel"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="discount-clear"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="discount-confirm"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('#discount-value-input').attributes('disabled')).toBeDefined();
    await wrapper.get('.dialog-backdrop').trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });
});
