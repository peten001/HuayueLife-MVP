import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MobileV2Header from './MobileV2Header.vue';

const props = {
  workspace: 'reservations' as const, totalTableCount: 0, availableTableCount: 0, inUseTableCount: 0,
  newOrderCount: 0, online: true, apiReachable: true, reconnecting: false,
  printingAvailability: 'NOT_ENABLED' as const, activeTableFilter: 'ALL' as const,
  operationalFilters: [{ value: 'ACTIVE', label: '待处理' }, { value: 'CONFIRMED', label: '已确认' }],
  activeOperationalFilter: 'ACTIVE',
};

describe('reservation Mobile V2 header', () => {
  it('uses the delivery shell controls and emits reservation status changes', async () => {
    const wrapper = mount(MobileV2Header, { props });
    expect(wrapper.find('.mobile-v2-header__menu-button').exists()).toBe(true);
    expect(wrapper.find('.mobile-v2-header__brand').text()).toBe('YunQiao');
    const filters = wrapper.findAll('.mobile-v2-filter-strip button');
    expect(filters.map(button => button.text())).toEqual(['待处理', '已确认']);
    await filters[1].trigger('click');
    expect(wrapper.emitted('selectOperationalFilter')).toEqual([['CONFIRMED']]);
  });
  it('hides list filters in reservation detail and chat, preserving the compact header', () => {
    const wrapper = mount(MobileV2Header, { props: { ...props, detailMode: true } });
    expect(wrapper.find('.mobile-v2-header__menu-button').exists()).toBe(true);
    expect(wrapper.find('.mobile-v2-filter-strip').exists()).toBe(false);
  });
});
