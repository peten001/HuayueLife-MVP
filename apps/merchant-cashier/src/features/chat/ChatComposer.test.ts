import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import ChatComposer from './ChatComposer.vue';

describe('ChatComposer focus controls', () => {
  beforeEach(() => setLocale('zh'));

  it('exposes stable focus and blur controls for message continuity', () => {
    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { disabled: false, sending: false },
    });
    const exposed = wrapper.vm.$.exposed as { focus: () => void; blur: () => void };

    exposed.focus();
    expect(document.activeElement).toBe(wrapper.get('textarea').element);
    exposed.blur();
    expect(document.activeElement).not.toBe(wrapper.get('textarea').element);
  });

  it('does not send empty content', async () => {
    const wrapper = mount(ChatComposer, {
      props: { disabled: false, sending: false },
    });

    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('offers image and location actions without submitting an empty text message', async () => {
    const wrapper = mount(ChatComposer, { props: { disabled: false, sending: false } });
    const buttons = wrapper.findAll('button[type="button"]');
    expect(buttons).toHaveLength(2);
    await buttons[1]?.trigger('click');
    expect(wrapper.emitted('location')).toHaveLength(1);
    expect(wrapper.emitted('send')).toBeUndefined();
  });
});
