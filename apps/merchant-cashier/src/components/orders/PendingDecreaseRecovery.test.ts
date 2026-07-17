import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import PendingDecreaseRecovery from './PendingDecreaseRecovery.vue';

describe('PendingDecreaseRecovery', () => {
  it('keeps an item-independent retry reachable and emits only retry', async () => {
    const wrapper = mount(PendingDecreaseRecovery, { props: { open: true } });

    expect(wrapper.get('[data-testid="pending-decrease-recovery"]').text())
      .toContain('请求结果尚未确认');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toEqual([[]]);
  });

  it('disables retry while writes are unavailable', () => {
    const wrapper = mount(PendingDecreaseRecovery, {
      props: { open: true, disabled: true },
    });
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });
});
