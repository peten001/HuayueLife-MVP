import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import type { CashierOrderView } from '@/components/common/view-models';
import type { TableSessionDetail } from '@/types';
import ConfirmDialog from './common/ConfirmDialog.vue';
import TableBillDetail from './bills/TableBillDetail.vue';
import OrderActionBar from './orders/OrderActionBar.vue';

describe('network write controls', () => {
  it('disables every available order action while writes are disabled', async () => {
    const order: CashierOrderView = {
      id: 'order-1',
      status: 'PENDING_ACCEPTANCE',
      orderType: 'DINE_IN',
    };
    const wrapper = mount(OrderActionBar, {
      props: { order, disabled: true },
    });

    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => expect(button.attributes('disabled')).toBeDefined());
    await buttons[0]?.trigger('click');
    expect(wrapper.emitted('action')).toBeUndefined();
  });

  it('disables TableSession ordering and closing while writes are disabled', async () => {
    const session: TableSessionDetail = {
      id: 'session-1',
      sessionNo: 'TS-1',
      merchantId: 'merchant-1',
      tableId: 'table-1',
      tableNo: 'A01',
      status: 'OPEN',
      openedAt: new Date().toISOString(),
      orderCount: 0,
      itemCount: 0,
      totalAmountVnd: '0',
      pendingOrderCount: 0,
      unfinishedOrderCount: 0,
      orders: [],
    };
    const wrapper = mount(TableBillDetail, {
      props: { session, actionsDisabled: true },
      global: { plugins: [createPinia()] },
    });

    const closeButton = wrapper.find<HTMLButtonElement>('.table-close-action');
    const orderButton = wrapper.find<HTMLButtonElement>('[data-testid="table-order-items"]');
    expect(orderButton.attributes('disabled')).toBeDefined();
    expect(closeButton.attributes('disabled')).toBeDefined();
    await orderButton.trigger('click');
    await closeButton.trigger('click');
    expect(wrapper.emitted('orderItems')).toBeUndefined();
    expect(wrapper.emitted('closeSession')).toBeUndefined();
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
