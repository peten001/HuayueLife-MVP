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

  it('marks the composer while the message input owns the software keyboard', async () => {
    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { disabled: false, sending: false },
    });
    const input = wrapper.get('textarea');

    await input.trigger('focus');
    expect(wrapper.get('form').classes()).toContain('is-input-focused');
    expect(wrapper.emitted('focus')).toHaveLength(1);

    await input.trigger('blur');
    expect(wrapper.get('form').classes()).not.toContain('is-input-focused');
    expect(wrapper.emitted('blur')).toHaveLength(1);
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
    const attachments = wrapper.findAll('.chat-composer__attachment');
    expect(attachments).toHaveLength(2);
    await attachments[1]?.trigger('click');
    expect(wrapper.emitted('location')).toHaveLength(1);
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('keeps the attachment toggle stable while text is entered', async () => {
    const wrapper = mount(ChatComposer, { props: { disabled: false, sending: false } });

    const more = wrapper.get('.chat-composer__more');
    expect(more.attributes('aria-expanded')).toBe('false');
    await more.trigger('click');
    expect(more.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.chat-composer__attachments').classes()).toContain('is-open');

    await wrapper.get('textarea').setValue('收到');
    expect(wrapper.find('.chat-composer__more').exists()).toBe(true);
    expect(wrapper.get('.chat-composer__send').classes()).not.toContain('is-empty');
  });

  it('submits text from the keyboard send action', async () => {
    const wrapper = mount(ChatComposer, { props: { disabled: false, sending: false } });
    const input = wrapper.get('textarea');

    await input.setValue('键盘发送');
    await input.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')).toEqual([['键盘发送']]);
  });

  it('keeps the focused input enabled while a message request is pending', () => {
    const wrapper = mount(ChatComposer, { props: { disabled: false, sending: true } });

    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('.chat-composer__send').attributes('disabled')).toBeDefined();
  });
});
