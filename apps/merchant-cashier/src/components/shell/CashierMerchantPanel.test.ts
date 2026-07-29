import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CashierMerchantPanel from './CashierMerchantPanel.vue';

describe('CashierMerchantPanel image fallback', () => {
  it('falls through failed images and then uses the initial without breaking a long name', async () => {
    const wrapper = mount(CashierMerchantPanel, { props: {
      merchantName: 'Nhà hàng Việt Nam có tên rất dài',
      merchantImageUrls: ['/broken-cover.jpg', '/logo.jpg'],
      businessOpen: true,
    } });
    expect(wrapper.get('img').attributes('src')).toBe('/broken-cover.jpg');
    await wrapper.get('img').trigger('error');
    expect(wrapper.get('img').attributes('src')).toBe('/logo.jpg');
    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('.cashier-merchant-panel__logo').text()).toBe('N');
    expect(wrapper.get('.cashier-merchant-panel__identity > strong').text()).toContain('Nhà hàng');
  });
});
