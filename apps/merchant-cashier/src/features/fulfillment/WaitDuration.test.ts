import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { setLocale } from '@/i18n';
import WaitDuration from './WaitDuration.vue';

describe('WaitDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T13:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    setLocale('zh');
  });

  it('shows a fixed service duration for completed orders instead of live elapsed time', () => {
    const wrapper = mount(WaitDuration, {
      props: {
        createdAt: '2026-08-15T01:25:07.000Z',
        endAt: '2026-08-15T01:37:26.000Z',
        compact: true,
      },
    });
    expect(wrapper.text()).toBe('12 分钟');

    vi.advanceTimersByTime(90_000);
    expect(wrapper.text()).toBe('12 分钟');
    wrapper.unmount();
  });

  it('keeps live waiting semantics for unfinished orders without endAt', async () => {
    const wrapper = mount(WaitDuration, {
      props: { createdAt: '2026-08-15T12:40:00.000Z', compact: true },
    });
    expect(wrapper.text()).toBe('20 分钟');
    vi.advanceTimersByTime(60_000);
    await nextTick();
    expect(wrapper.text()).toBe('21 分钟');
    wrapper.unmount();
  });

  it('renders a neutral value-only label when an end time is given', () => {
    const wrapper = mount(WaitDuration, {
      props: {
        createdAt: '2026-08-15T01:25:07.000Z',
        endAt: '2026-08-15T01:37:26.000Z',
      },
    });
    expect(wrapper.text()).toBe('12 分钟');
    wrapper.unmount();
  });
});
