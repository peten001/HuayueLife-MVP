import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReturnItemDialog from './ReturnItemDialog.vue';

const item = {
  id: 'item-1',
  productNameZhSnapshot: '牛肉粉',
  productNameViSnapshot: 'Phở bò',
  quantity: 3,
  subtotalVnd: '180000',
};

describe('ReturnItemDialog', () => {
  it('asks only for a bounded return quantity and never renders a reason field', async () => {
    const wrapper = mount(ReturnItemDialog, { props: { open: true, item } });

    expect(wrapper.get('[data-testid="return-item-dialog"]').text()).toContain('退菜：牛肉粉');
    expect(wrapper.get('[data-testid="return-item-dialog"]').text()).toContain('确定退菜？');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('textarea').exists()).toBe(false);

    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    expect(wrapper.get('output').text()).toBe('3');

    await wrapper.get('button.primary-action').trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([[3]]);
  });

  it('resets to one when a different item opens', async () => {
    const wrapper = mount(ReturnItemDialog, { props: { open: true, item } });
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    expect(wrapper.get('output').text()).toBe('2');

    await wrapper.setProps({
      item: { ...item, id: 'item-2', productNameZhSnapshot: '柠檬茶', quantity: 2 },
    });
    expect(wrapper.get('output').text()).toBe('1');
  });

  it('freezes quantity and prevents closing while an outcome is uncertain', async () => {
    const wrapper = mount(ReturnItemDialog, {
      props: {
        open: true,
        item,
        outcomeUncertain: true,
        fixedQuantity: 2,
      },
    });

    expect(wrapper.get('output').text()).toBe('2');
    expect(wrapper.get('[data-testid="return-outcome-uncertain"]').text()).toContain('结果尚未确认');
    expect(wrapper.get('[aria-label="增加数量"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[aria-label="减少数量"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button.secondary-action').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button.primary-action').text()).toContain('重试原请求');

    await wrapper.get('.dialog-backdrop').trigger('click');
    await wrapper.get('button.secondary-action').trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    await wrapper.get('button.primary-action').trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([[2]]);
  });
});
