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
    push.working.value = false;
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

  it('stays hidden on mobile until notification settings are opened from the menu', async () => {
    const wrapper = mount(OrderPushControl, { props: { mobile: true } });
    await flushPromises();

    expect(wrapper.find('[data-testid="mobile-notification-settings"]').exists()).toBe(false);

    (wrapper.vm as unknown as { openSettings: () => void }).openSettings();
    await flushPromises();

    const toggle = wrapper.get('[data-testid="mobile-notification-switch"]');
    expect(toggle.attributes('role')).toBe('switch');
    expect(toggle.attributes('aria-checked')).toBe('false');
    expect(wrapper.text()).toContain('通知设置');
  });

  it('keeps the mobile settings sheet open while toggling notifications', async () => {
    const wrapper = mount(OrderPushControl, { props: { mobile: true } });
    await flushPromises();
    (wrapper.vm as unknown as { openSettings: () => void }).openSettings();
    await flushPromises();

    await wrapper.get('[data-testid="mobile-notification-switch"]').trigger('click');
    await flushPromises();
    expect(push.state.value).toBe('enabled');
    expect(wrapper.get('[data-testid="mobile-notification-switch"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.find('[data-testid="mobile-notification-settings"]').exists()).toBe(true);

    await wrapper.get('[data-testid="mobile-notification-switch"]').trigger('click');
    await flushPromises();
    expect(push.state.value).toBe('disabled');
    expect(wrapper.get('[data-testid="mobile-notification-switch"]').attributes('aria-checked')).toBe('false');
  });
});
