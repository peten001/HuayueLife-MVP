import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cashierStorageKeys } from '@/config';
import { setLocale } from '@/i18n';
import { useSoundStore } from './sound';
import type { NewOrderAlert } from '@/features/sound/new-order-alerts';

const frequencies: number[] = [];
const starts: number[] = [];
const spoken: FakeUtterance[] = [];
let audioState = 'running';
const resume = vi.fn(async () => undefined);
const cancel = vi.fn();
class FakeUtterance {
  lang = ''; rate = 1; volume = 1; voice: unknown;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
class FakeContext {
  get state() { return audioState; }
  currentTime = 10; destination = {}; resume = resume;
  createOscillator() {
    const frequency = { set value(value: number) { frequencies.push(value); } };
    return { type: '', frequency, connect: vi.fn(), disconnect: vi.fn(), start: (value: number) => starts.push(value), stop: vi.fn() };
  }
  createGain() { return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; }
}
const order = (id: string, orderType: NewOrderAlert['orderType'] = 'DINE_IN'): NewOrderAlert => ({ id, orderType, tableNo: '02' });

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); setActivePinia(createPinia()); setLocale('zh');
  frequencies.length = starts.length = spoken.length = 0; audioState = 'running'; resume.mockClear(); cancel.mockClear();
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', {
    resume: vi.fn(), cancel,
    getVoices: () => ['zh-CN', 'vi-VN', 'en-US'].map(lang => ({ lang })),
    speak: (utterance: FakeUtterance) => { spoken.push(utterance); setTimeout(() => utterance.onend?.(), 10); },
  });
});
afterEach(() => { useSoundStore('cashier').resetMerchant(); useSoundStore('kds').resetMerchant(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function deliver(terminal: 'cashier' | 'kds', value: NewOrderAlert) {
  const sound = useSoundStore(terminal); await sound.enable(); sound.notifyNewOrders([], 'm'); sound.notifyNewOrders([value], 'm');
  await vi.runAllTimersAsync(); return sound;
}

describe('new order audio settings and playback', () => {
  it('defaults off and migrates the existing terminal setting without enabling the other terminal', () => {
    expect(useSoundStore().enabled).toBe(false);
    setActivePinia(createPinia()); localStorage.setItem(cashierStorageKeys.soundEnabled, '1');
    expect(useSoundStore().enabled).toBe(true); expect(useSoundStore('kds').enabled).toBe(false);
  });
  it('restores independent mode, volume and enabled preferences, but requires a gesture after reload', async () => {
    const cashier = useSoundStore('cashier'); cashier.setMode('tone'); cashier.setVolume(35); await cashier.enable();
    const kitchen = useSoundStore('kds'); kitchen.setMode('speech'); kitchen.setVolume(85); await kitchen.enable();
    setActivePinia(createPinia());
    expect(useSoundStore('cashier')).toMatchObject({ enabled: true, mode: 'tone', volume: 35, active: false });
    expect(useSoundStore('kds')).toMatchObject({ enabled: true, mode: 'speech', volume: 85, active: false });
  });
  it('does not overwrite the released mobile sound preference when desktop audio is enabled or disabled', async () => {
    localStorage.setItem(cashierStorageKeys.soundEnabled, '0');
    const sound = useSoundStore(); await sound.enable();
    expect(localStorage.getItem(cashierStorageKeys.soundEnabled)).toBe('0');
    localStorage.setItem(cashierStorageKeys.soundEnabled, '1'); sound.disable();
    expect(localStorage.getItem(cashierStorageKeys.soundEnabled)).toBe('1');
  });
  it('plays the unchanged cashier doorbell in both cashier and KDS', async () => {
    await deliver('cashier', order('a'));
    expect(frequencies).toEqual([784, 622]); expect(starts[1]! - starts[0]!).toBeCloseTo(.2);
    const cashierFrequencies = [...frequencies]; const cashierStarts = [...starts];
    frequencies.length = starts.length = 0;
    await deliver('kds', order('a'));
    expect(frequencies).toEqual(cashierFrequencies); expect(starts).toEqual(cashierStarts);
    expect(spoken.map(utterance => utterance.text)).toEqual(['02桌有新订单，请查看。', '02桌有新订单，请制作。']);
  });
  it.each(['tone', 'speech', 'both'] as const)('honors %s mode', async mode => {
    useSoundStore().setMode(mode); await deliver('cashier', order('a'));
    expect(frequencies.length).toBe(mode === 'speech' ? 0 : 2);
    expect(spoken.length).toBe(mode === 'tone' ? 0 : 1);
  });
  it.each([
    ['zh', 'cashier', 'DINE_IN', '02桌有新订单，请查看。', 'zh-CN'],
    ['zh', 'cashier', 'DELIVERY', '有新的商家配送订单，请查看。', 'zh-CN'],
    ['zh', 'cashier', 'PICKUP', '有新的到店自取订单，请查看。', 'zh-CN'],
    ['zh', 'kds', 'DINE_IN', '02桌有新订单，请制作。', 'zh-CN'],
    ['zh', 'kds', 'DELIVERY', '商家配送新订单，请制作。', 'zh-CN'],
    ['zh', 'kds', 'PICKUP', '到店自取新订单，请制作。', 'zh-CN'],
    ['vi', 'cashier', 'DINE_IN', 'Bàn 02 có đơn mới, vui lòng kiểm tra.', 'vi-VN'],
    ['vi', 'cashier', 'DELIVERY', 'Có đơn quán giao hàng mới, vui lòng kiểm tra.', 'vi-VN'],
    ['vi', 'cashier', 'PICKUP', 'Có đơn tự đến lấy mới, vui lòng kiểm tra.', 'vi-VN'],
    ['vi', 'kds', 'DINE_IN', 'Bàn 02 có đơn mới, vui lòng chế biến.', 'vi-VN'],
    ['vi', 'kds', 'DELIVERY', 'Có đơn quán giao hàng mới, vui lòng chế biến.', 'vi-VN'],
    ['vi', 'kds', 'PICKUP', 'Có đơn tự đến lấy mới, vui lòng chế biến.', 'vi-VN'],
    ['en', 'cashier', 'DINE_IN', 'Table 02 has a new order. Please check.', 'en-US'],
    ['en', 'cashier', 'DELIVERY', 'New merchant delivery order. Please check.', 'en-US'],
    ['en', 'cashier', 'PICKUP', 'New pickup order. Please check.', 'en-US'],
    ['en', 'kds', 'DINE_IN', 'Table 02 has a new order. Please prepare.', 'en-US'],
    ['en', 'kds', 'DELIVERY', 'New merchant delivery order. Please prepare.', 'en-US'],
    ['en', 'kds', 'PICKUP', 'New pickup order. Please prepare.', 'en-US'],
  ] as const)('speaks %s %s %s with localized content', async (locale, terminal, type, text, lang) => {
    setLocale(locale); await nextTick(); await deliver(terminal, order('a', type));
    expect(spoken).toHaveLength(1); expect(spoken[0]).toMatchObject({ text, lang, volume: .7 });
  });
  it('falls back to dine-in speech when a table number is unavailable', async () => {
    await deliver('kds', { id: 'x', orderType: 'DINE_IN' }); expect(spoken[0]?.text).toBe('有新的堂食订单，请制作。');
  });
  it('queues simultaneous orders without cancelling or dropping earlier speech', async () => {
    const sound = useSoundStore(); sound.setMode('speech'); await sound.enable(); sound.notifyNewOrders([], 'm');
    sound.notifyNewOrders([order('a'), order('b', 'DELIVERY'), order('c', 'PICKUP')], 'm');
    await vi.runAllTimersAsync(); expect(spoken).toHaveLength(3); expect(cancel).not.toHaveBeenCalled();
  });
  it('mutes disabled or zero-volume reminders without replaying them when re-enabled', async () => {
    const sound = useSoundStore(); sound.notifyNewOrders([], 'm'); sound.notifyNewOrders([order('a')], 'm');
    await sound.enable(); sound.setVolume(0); sound.notifyNewOrders([order('b')], 'm');
    sound.setVolume(80); sound.notifyNewOrders([order('a'), order('b')], 'm'); await vi.runAllTimersAsync();
    expect(spoken).toHaveLength(0); expect(frequencies).toHaveLength(0);
  });
  it('surfaces resume failure without reporting active audio', async () => {
    audioState = 'suspended'; resume.mockRejectedValueOnce(new Error('denied'));
    expect(await useSoundStore().enable()).toBe(false); expect(useSoundStore().active).toBe(false); expect(useSoundStore().lastError).toBe('sound.unlockFailed');
  });
  it('allows speech-only devices and exposes unsupported selected modes', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const sound = useSoundStore(); sound.setMode('speech'); expect(await sound.enable()).toBe(true);
    sound.setMode('tone'); expect(sound.supported).toBe(false); expect(await sound.enable()).toBe(false);
  });
  it('stops pending playback when disabled or language changes', async () => {
    const sound = useSoundStore(); await sound.enable(); sound.notifyNewOrders([], 'm'); sound.notifyNewOrders([order('a'), order('b')], 'm'); sound.disable();
    await vi.runAllTimersAsync(); expect(spoken).toHaveLength(0);
    await sound.enable(); sound.notifyNewOrders([order('c'), order('d')], 'm'); setLocale('vi'); await nextTick(); await vi.runAllTimersAsync(); expect(spoken).toHaveLength(0);
  });
  it('does not claim speech is available when the browser reports a voice error', async () => {
    vi.stubGlobal('speechSynthesis', { resume: vi.fn(), cancel, getVoices: () => [], speak: (u: FakeUtterance) => u.onerror?.() });
    const sound = await deliver('cashier', order('a')); expect(sound.lastError).toBe('sound.speechUnavailable');
  });
});

describe('new order deduplication', () => {
  it('silently establishes an authoritative baseline; mutations cannot prematurely initialize it', () => {
    const sound = useSoundStore(); expect(sound.notifyNewOrders([order('a')], 'm', false)).toEqual([]);
    expect(sound.notifyNewOrders([order('a'), order('b')], 'm')).toEqual([]);
    expect(sound.notifyNewOrders([order('c')], 'm')).toEqual(['c']);
  });
  it('does not replay on refresh, removal, reappearance, remount or browser reload', () => {
    const sound = useSoundStore(); sound.notifyNewOrders([], 'm'); expect(sound.notifyNewOrders([order('a')], 'm')).toEqual(['a']);
    sound.notifyNewOrders([], 'm'); expect(sound.notifyNewOrders([order('a')], 'm')).toEqual([]);
    sound.resetMerchant('m'); sound.notifyNewOrders([], 'm'); expect(sound.notifyNewOrders([order('a')], 'm')).toEqual([]);
    setActivePinia(createPinia()); const restored = useSoundStore(); restored.notifyNewOrders([], 'm'); expect(restored.notifyNewOrders([order('a')], 'm')).toEqual([]);
  });
  it('observes filtered-out kitchen orders silently so switching stations does not replay them', () => {
    const sound = useSoundStore('kds'); sound.notifyNewOrders([], 'm');
    expect(sound.notifyNewOrders([{ ...order('a'), announce: false }], 'm')).toEqual([]);
    expect(sound.notifyNewOrders([order('a')], 'm')).toEqual([]);
  });
  it('keeps a large current board quiet even when it exceeds the persisted history limit', () => {
    const sound = useSoundStore('kds'); const largeBoard = Array.from({ length: 5005 }, (_, id) => order(String(id)));
    sound.notifyNewOrders(largeBoard, 'm'); expect(sound.notifyNewOrders(largeBoard, 'm')).toEqual([]);
    expect(Object.keys(JSON.parse(localStorage.getItem('yunqiao_kds_new_order_seen_v1:m')!))).toHaveLength(5000);
  });
  it('keeps merchants and terminals independent', () => {
    const sound = useSoundStore(); sound.notifyNewOrders([], 'm1'); sound.notifyNewOrders([], 'm2');
    expect(sound.notifyNewOrders([order('a')], 'm1')).toEqual(['a']); expect(sound.notifyNewOrders([order('a')], 'm2')).toEqual(['a']);
    const kds = useSoundStore('kds'); kds.notifyNewOrders([], 'm1'); expect(kds.notifyNewOrders([order('a')], 'm1')).toEqual(['a']);
  });
  it('survives corrupt or blocked storage without interrupting order processing', () => {
    localStorage.setItem('yunqiao_cashier_new_order_sound_v1', 'invalid'); localStorage.setItem('yunqiao_cashier_new_order_seen_v1:m', '["bad"]');
    const sound = useSoundStore(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    sound.notifyNewOrders([], 'm'); expect(sound.notifyNewOrders([order('a')], 'm')).toEqual(['a']); expect(sound.notifyNewOrders([order('a')], 'm')).toEqual([]);
  });
});
