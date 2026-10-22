import { createPinia, setActivePinia } from 'pinia';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n';
import { useSoundStore } from '@/stores/sound';
import SoundPreferences from './SoundPreferences.vue';
import SoundSettingsDialog from './SoundSettingsDialog.vue';

beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); setLocale('zh'); });
afterEach(() => { setLocale('zh'); vi.restoreAllMocks(); });
describe('device sound settings', () => {
  it.each(['zh', 'vi', 'en'] as const)('localizes modes, order types and off status in %s', locale => {
    setLocale(locale); const wrapper = mount(SoundPreferences, { props: { terminal: 'cashier' } });
    expect(wrapper.findAll('select option')).toHaveLength(6);
    expect(wrapper.find('[role=switch]').attributes('aria-checked')).toBe('false');
    expect(wrapper.text()).toContain(locale === 'zh' ? '已关闭新订单声音' : locale === 'vi' ? 'Đã tắt âm báo đơn mới' : 'New order sound is off'); wrapper.unmount();
  });
  it.each(['cashier', 'kds'] as const)('shows exactly one settings panel for %s, with no other terminal controls', terminal => {
    const wrapper = mount(SoundPreferences, { props: { terminal } });
    expect(wrapper.findAll('.sound-preferences')).toHaveLength(1);
    expect(wrapper.get('.sound-preferences').attributes('data-terminal')).toBe(terminal);
    expect(wrapper.text()).toContain(terminal === 'cashier' ? '只保存在当前设备的收银端' : '只保存在当前设备的 KDS 端');
    expect(wrapper.text()).not.toContain(terminal === 'cashier' ? '厨房使用两声' : '收银使用轻柔');
    wrapper.unmount();
  });
  it('updates only this terminal’s saved mode and volume without writing merchant settings', async () => {
    const wrapper = mount(SoundPreferences, { props: { terminal: 'kds' } });
    await wrapper.findAll('select')[0]!.setValue('tone'); await wrapper.get('input[type=range]').setValue('35');
    expect(useSoundStore('kds')).toMatchObject({ mode: 'tone', volume: 35 }); expect(useSoundStore('cashier')).toMatchObject({ mode: 'both', volume: 70 }); wrapper.unmount();
  });
  it('shows a reactivation action for a saved preference, and toggles off directly', async () => {
    useSoundStore().enabled = true; const wrapper = mount(SoundPreferences, { props: { terminal: 'cashier' } });
    expect(wrapper.text()).toContain('启用声音');
    await wrapper.get('[role=switch]').trigger('click'); expect(useSoundStore().enabled).toBe(false); expect(wrapper.text()).toContain('已关闭'); wrapper.unmount();
  });
  it('shows a localized error in the settings panel and prevents silent zero-volume previews', async () => {
    const sound = useSoundStore(); sound.enabled = true; sound.setVolume(0); sound.lastError = 'sound.speechUnavailable';
    const wrapper = mount(SoundPreferences, { props: { terminal: 'cashier' } });
    expect(wrapper.get('[role=alert]').text()).toContain('语音暂不可用'); expect(wrapper.text()).toContain('音量为 0');
    expect(wrapper.findAll('button').find(button => button.text() === '试听')?.attributes('disabled')).toBeDefined();
    setLocale('vi'); await flushPromises(); expect(wrapper.get('[role=alert]').text()).toContain('Giọng nói chưa khả dụng'); wrapper.unmount();
  });
  it('selects the requested order type for preview and recovers the loading state', async () => {
    const sound = useSoundStore('kds'); const preview = vi.spyOn(sound, 'preview').mockResolvedValue();
    const wrapper = mount(SoundPreferences, { props: { terminal: 'kds' } });
    // Make the preview available independently of browser APIs in jsdom.
    Object.defineProperty(sound, 'supported', { value: true });
    await wrapper.findAll('select')[1]!.setValue('PICKUP');
    await wrapper.findAll('button').find(button => button.text() === '试听')!.trigger('click'); await flushPromises();
    expect(preview).toHaveBeenCalledWith('PICKUP'); expect(wrapper.text()).not.toContain('播放中'); wrapper.unmount();
  });
  it('closes the dialog on Escape and restores keyboard focus', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const wrapper = mount(SoundSettingsDialog, { attachTo: document.body }); await flushPromises();
    await wrapper.get('[role=dialog]').trigger('keydown', { key: 'Escape' }); expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
  });
});
