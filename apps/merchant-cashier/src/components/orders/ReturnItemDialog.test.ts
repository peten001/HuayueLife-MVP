import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import ReturnItemDialog from './ReturnItemDialog.vue';

const item = {
  id: 'item-1',
  productNameZhSnapshot: '牛肉粉',
  productNameViSnapshot: 'Phở bò',
  quantity: 3,
  subtotalVnd: '180000',
};

describe('ReturnItemDialog', () => {
  afterEach(() => setLocale('zh'));

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

  it('shows a localized danger confirmation when the full return empties the table', async () => {
    const wrapper = mount(ReturnItemDialog, {
      props: {
        open: true,
        item: { ...item, quantity: 1 },
        lastOrderItem: true,
        lastTableItem: true,
      },
    });

    expect(wrapper.get('[data-testid="last-item-return-danger"]').text())
      .toContain('桌账会自动关闭并释放桌台');
    expect(wrapper.get('h3').text()).toBe('确定退掉最后 1 份该菜品吗？');

    setLocale('vi');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="last-item-return-danger"]').text())
      .toContain('phiên bàn sẽ tự đóng');

    setLocale('en');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="last-item-return-danger"]').text())
      .toContain('table bill will close');

    await wrapper.get('button.primary-action').trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([[1]]);
  });

  it('uses the exact last-serving prompt for a quantity-one item even when its order has other items', () => {
    const wrapper = mount(ReturnItemDialog, {
      props: {
        open: true,
        item: { ...item, quantity: 1 },
        lastOrderItem: false,
        lastTableItem: false,
      },
    });

    expect(wrapper.get('h3').text()).toBe('确定退掉最后 1 份该菜品吗？');
    expect(wrapper.find('[data-testid="last-item-return-danger"]').exists()).toBe(false);
  });

  it('uses the normal confirmation for a partial return and warns only at the full quantity', async () => {
    const wrapper = mount(ReturnItemDialog, {
      props: { open: true, item, lastOrderItem: true, lastTableItem: false },
    });

    expect(wrapper.find('[data-testid="last-item-return-danger"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('确定退菜？');

    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    expect(wrapper.get('[data-testid="last-item-return-danger"]').text())
      .toContain('其他订单不受影响');

    await wrapper.get('button.secondary-action').trigger('click');
    expect(wrapper.emitted('cancel')).toEqual([[]]);
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });
});
