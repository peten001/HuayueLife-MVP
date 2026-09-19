import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrderPush } from '@/composables/useOrderPush';
import OrderPushControl from './OrderPushControl.vue';

vi.mock('@/composables/useOrderPush', async () => {
  const { ref } = await import('vue');
  const state = ref<'disabled' | 'enabled'>('disabled');
  const working = ref(false);
  return {
    useOrderPush: () => ({
      state,
      working,
      refresh: vi.fn(async () => undefined),
      enable: vi.fn(async () => { state.value = 'enabled'; }),
      disable: vi.fn(async () => { state.value = 'disabled'; }),
    }),
  };
});

const push = useOrderPush({ value: 'zh' });

describe('OrderPushControl', () => {
  beforeEach(() => {
    push.state.value = 'disabled';
  });

  it('closes the enable prompt without disabling notifications', async () => {
    const wrapper = mount(OrderPushControl);
    await flushPromises();
    await wrapper.get('.order-push-control__action').trigger('click');
    await flushPromises();

    expect(wrapper.find('.order-push-control').exists()).toBe(false);
    expect(push.state.value).toBe('enabled');

    (wrapper.vm as unknown as { openSettings: () => void }).openSettings();
    await flushPromises();
    expect(wrapper.find('.order-push-control__secondary').exists()).toBe(true);
    await wrapper.get('.order-push-control__close').trigger('click');
    expect(wrapper.find('.order-push-control').exists()).toBe(false);
    expect(push.state.value).toBe('enabled');
  });

  it('does not show a persistent banner for an existing subscription', async () => {
    push.state.value = 'enabled';
    const wrapper = mount(OrderPushControl);
    await flushPromises();

    expect(wrapper.find('.order-push-control').exists()).toBe(false);
    (wrapper.vm as unknown as { openSettings: () => void }).openSettings();
    await flushPromises();
    expect(wrapper.find('.order-push-control').exists()).toBe(true);
  });
});
