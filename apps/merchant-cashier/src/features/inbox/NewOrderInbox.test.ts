import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import type { MerchantOrder } from '@/types';
import NewOrderInbox from './NewOrderInbox.vue';

const pickupOrder = {
  id: 'pickup-1',
  orderNo: 'DEMO-1004',
  orderType: 'PICKUP',
  status: 'PENDING_ACCEPTANCE',
  contactName: 'Demo Customer',
} as MerchantOrder;

const deliveryOrder = {
  ...pickupOrder,
  id: 'delivery-1',
  orderNo: 'DEMO-1005',
  orderType: 'DELIVERY',
} as MerchantOrder;

describe('NewOrderInbox', () => {
  afterEach(() => setLocale('zh'));

  it('renders a modal order chooser and preserves select and dismiss actions', async () => {
    setLocale('zh');
    const wrapper = mount(NewOrderInbox, {
      props: {
        open: true,
        auto: true,
        orders: [pickupOrder, deliveryOrder],
      },
    });

    expect(wrapper.get('.new-order-inbox__panel').attributes('aria-modal')).toBe('true');
    expect(wrapper.findAll('.new-order-inbox__group')).toHaveLength(2);
    expect(wrapper.text()).toContain('到店自取');
    expect(wrapper.text()).toContain('商家配送');

    await wrapper.findAll('.new-order-inbox__group > button')[0]!.trigger('click');
    expect(wrapper.emitted('select')).toEqual([[pickupOrder]]);

    await wrapper.get('.new-order-inbox__footer button').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
