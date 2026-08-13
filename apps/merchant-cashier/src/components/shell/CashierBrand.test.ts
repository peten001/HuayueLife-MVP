import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { cashierConfig } from '@/config';
import CashierBrand from './CashierBrand.vue';

describe('CashierBrand', () => {
  it('uses the exact Cashier name and official mark asset', () => {
    const wrapper = mount(CashierBrand);

    expect(cashierConfig.brandName).toBe('YunQiao Cashier');
    expect(wrapper.attributes('aria-label')).toBe('YunQiao Cashier');
    expect(wrapper.get('.cashier-brand__name').text()).toBe('YunQiao Cashier');
    expect(wrapper.get('img').attributes('src')).toBe('/yunqiao-cashier-mark.png');
  });
});
