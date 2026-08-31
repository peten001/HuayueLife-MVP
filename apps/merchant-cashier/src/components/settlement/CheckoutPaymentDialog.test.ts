import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import CheckoutPaymentDialog from './CheckoutPaymentDialog.vue';

function mountDialog(extraProps: Record<string, unknown> = {}) {
  return mount(CheckoutPaymentDialog, {
    attachTo: document.body,
    props: { open: true, amountVnd: '125000', ...extraProps },
  });
}

describe('CheckoutPaymentDialog', () => {
  afterEach(() => {
    setLocale('zh');
    document.body.innerHTML = '';
  });

  it('can omit the descriptive copy without changing the checkout controls', () => {
    const wrapper = mountDialog({ showDescription: false });

    expect(wrapper.find('.payment-dialog header p').exists()).toBe(false);
    expect(wrapper.find('.payment-options').exists()).toBe(true);
    expect(wrapper.find('.payment-dialog footer').exists()).toBe(true);
  });

  it('requires an explicit payment choice before confirming', async () => {
    const wrapper = mountDialog();
    const confirm = wrapper.get('footer .primary-action');
    expect(confirm.attributes('disabled')).toBeDefined();

    await wrapper.get('input[value="BANK_TRANSFER"]').setValue(true);
    expect(confirm.attributes('disabled')).toBeUndefined();
    await confirm.trigger('click');

    expect(wrapper.emitted('confirm')).toEqual([['BANK_TRANSFER']]);
    wrapper.unmount();
  });

  it('cancels with zero completion emission', async () => {
    const wrapper = mountDialog();
    await wrapper.get('footer .secondary-action').trigger('click');

    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(wrapper.emitted('confirm')).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps the dialog open to surface a nearby settlement error', () => {
    const wrapper = mountDialog({ error: '网络异常，请重试' });
    expect(wrapper.get('[role="alert"]').text()).toBe('网络异常，请重试');
    expect(wrapper.find('.payment-dialog').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps the dark settlement structure with a dedicated cancel action', () => {
    const wrapper = mountDialog();
    const cancel = wrapper.get('footer .secondary-action');
    const close = wrapper.get('.payment-dialog__close');
    expect(wrapper.find('.payment-dialog').exists()).toBe(true);
    expect(close.attributes('aria-label')).toBeTruthy();
    expect(cancel.element.getAttribute('disabled')).toBeNull();
    wrapper.unmount();
  });

  it('keeps a recognizable disabled confirm state', () => {
    const wrapper = mountDialog();
    const confirm = wrapper.get('footer .primary-action');
    expect(confirm.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});
