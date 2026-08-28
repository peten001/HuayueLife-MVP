import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import CashierMobileNavigation from './CashierMobileNavigation.vue';

describe('CashierMobileNavigation V5', () => {
  afterEach(() => setLocale('zh'));

  it('keeps the three fulfillment routes and reuses the account avatar as the fourth My item', async () => {
    const wrapper = mount(CashierMobileNavigation, {
      props: {
        merchantName: '演示餐厅',
        role: 'MANAGER',
      },
      global: {
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          },
          PwaInstallBanner: true,
        },
      },
    });

    const items = wrapper.findAll('.cashier-mobile-navigation > *');
    expect(items).toHaveLength(4);
    expect(items.slice(0, 3).map((item) => item.text().trim())).toEqual([
      '桌台总览',
      '到店自取',
      '商家配送',
    ]);
    expect(wrapper.get('.cashier-mobile-account .account-menu__mobile-label').text()).toBe('我的');
    expect(wrapper.text()).not.toContain('订单记录');
    expect(wrapper.find('.cashier-mobile-account .account-menu__avatar').exists()).toBe(true);

    await wrapper.get('.cashier-mobile-account .account-menu__trigger').trigger('click');
    expect(wrapper.find('[data-testid="employee-menu-popover"]').exists()).toBe(true);
  });
});
