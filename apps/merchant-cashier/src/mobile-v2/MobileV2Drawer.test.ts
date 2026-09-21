import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import MobileV2Drawer from './MobileV2Drawer.vue';

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ meta: {} }),
}));

describe('MobileV2Drawer notification settings', () => {
  it('closes the drawer and opens push settings', async () => {
    const wrapper = mount(MobileV2Drawer, {
      props: { role: 'STAFF', pushSettingsAvailable: true },
      global: { stubs: { RouterLink: true } },
    });

    expect(wrapper.get('[data-testid="mobile-push-settings-entry"]').text()).toBe('通知设置');
    await wrapper.get('[data-testid="mobile-push-settings-entry"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(wrapper.emitted('openPushSettings')).toHaveLength(1);
  });
});
