import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import type { MerchantOrder } from '@/types';
import ConfirmDialog from './common/ConfirmDialog.vue';
import DineInActionDock from '@/features/dine-in/DineInActionDock.vue';
import FulfillmentActionDock from '@/features/fulfillment/FulfillmentActionDock.vue';

const pickupOrder: MerchantOrder = {
  id: 'order-1',
  orderNo: 'TEST-1',
  merchantId: 'merchant-1',
  orderType: 'PICKUP',
  status: 'PENDING_ACCEPTANCE',
  itemAmountVnd: '50000',
  deliveryFeeVnd: '0',
  totalAmountVnd: '50000',
  settlementStatus: 'UNSETTLED',
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  items: [],
};

describe('network write controls', () => {
  it('keeps printing independent while disabling accept and checkout writes', async () => {
    const wrapper = mount(DineInActionDock, {
      props: {
        sessionId: 'session-1',
        actionsDisabled: true,
      },
      global: {
        plugins: [createPinia()],
        stubs: {
          PrintJobActions: {
            props: ['disabled'],
            template: '<button data-testid="print-primary" :disabled="disabled">Print</button>',
          },
        },
      },
    });

    expect(wrapper.get('[data-testid="print-primary"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="dinein-accept"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="dinein-checkout"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="dinein-accept"]').trigger('click');
    await wrapper.get('[data-testid="dinein-checkout"]').trigger('click');
    expect(wrapper.emitted('accept')).toBeUndefined();
    expect(wrapper.emitted('checkout')).toBeUndefined();
  });

  it('disables the current pickup workflow action while writes are unavailable', async () => {
    const wrapper = mount(FulfillmentActionDock, {
      props: { order: pickupOrder, disabled: true },
      global: {
        stubs: {
          PrintJobActions: {
            template: '<button data-testid="print-primary">Print</button>',
          },
        },
      },
    });
    const action = wrapper.findAll('button').at(-1)!;
    expect(action.attributes('disabled')).toBeDefined();
    await action.trigger('click');
    expect(wrapper.emitted('action')).toBeUndefined();
  });

  it('uses the cashier-confirmed pickup and delivery completion labels', () => {
    const pickup = mount(FulfillmentActionDock, {
      props: { order: { ...pickupOrder, status: 'READY' } },
      global: { stubs: { PrintJobActions: true } },
    });
    const delivery = mount(FulfillmentActionDock, {
      props: {
        order: { ...pickupOrder, orderType: 'DELIVERY', status: 'DELIVERING' },
      },
      global: { stubs: { PrintJobActions: true } },
    });

    expect(pickup.text()).toContain('确认取餐');
    expect(delivery.text()).toContain('配送完成');
  });

  it('disables only the confirming write action while the network is degraded', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: {
        open: true,
        title: 'Confirm',
        description: 'Description',
        cancelLabel: 'Cancel',
        confirmLabel: 'Confirm',
        confirmDisabled: true,
      },
    });
    const [cancelButton, confirmButton] = wrapper.findAll('button');
    expect(cancelButton?.attributes('disabled')).toBeUndefined();
    expect(confirmButton?.attributes('disabled')).toBeDefined();
    await confirmButton?.trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });
});
