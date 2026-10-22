import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { isKdsTerminal } from '@/config/terminal';
import { t, useI18n } from '@/i18n';
import { readCashierStorage, writeCashierStorage } from '@/platform/safe-storage';
import { newOrderSpeechKey, newOrderTones, speechLanguage, type NewOrderAlert, type SoundMode, type SoundTerminal } from '@/features/sound/new-order-alerts';

function createSoundStore(terminal: SoundTerminal) {
  return defineStore(`new-order-sound-${terminal}`, () => {
    const prefix = `yunqiao_${terminal}`;
    const preferenceKey = `${prefix}_new_order_sound_v1`;
    const saved = readJson(preferenceKey);
    const enabled = ref(typeof saved?.enabled === 'boolean' ? saved.enabled : readCashierStorage('local', `${prefix}_sound_enabled`) === '1');
    const mode = ref<SoundMode>(saved?.mode === 'tone' || saved?.mode === 'speech' ? saved.mode : 'both');
    const volume = ref(typeof saved?.volume === 'number' && Number.isFinite(saved.volume) ? Math.min(100, Math.max(0, saved.volume)) : 70);
    const unlocked = ref(false);
    const working = ref(false);
    const lastError = ref('');
    const lastNotifiedOrderIds = ref<string[]>([]);
    const toneSupported = typeof window !== 'undefined' && Boolean(window.AudioContext ?? window.webkitAudioContext);
    const speechSupported = typeof window !== 'undefined' && Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
    const supported = computed(() => mode.value === 'tone' ? toneSupported : mode.value === 'speech' ? speechSupported : toneSupported || speechSupported);
    const active = computed(() => enabled.value && unlocked.value && volume.value > 0);
    const initializedMerchants = new Set<string>();
    const ledgers = new Map<string, Map<string, number>>();
    const { locale } = useI18n();
    let audioContext: AudioContext | null = null;
    let sequence = 0;
    let playing = false;
    let speech: SpeechSynthesisUtterance | null = null;
    let finishPlayback: (() => void) | undefined;
    let activeMerchant: string | undefined;
    const oscillators = new Set<OscillatorNode>();
    const queue: Array<{ order: NewOrderAlert | null; createdAt: number }> = [];

    function persist() {
      writeCashierStorage('local', preferenceKey, JSON.stringify({ enabled: enabled.value, mode: mode.value, volume: volume.value }));
    }
    function stop() {
      sequence += 1;
      queue.splice(0);
      const finish = finishPlayback;
      finishPlayback = undefined;
      if (speech) window.speechSynthesis?.cancel();
      speech = null;
      finish?.();
      for (const oscillator of oscillators) {
        try { oscillator.stop(); } catch { /* Already ended. */ }
      }
      oscillators.clear();
      playing = false;
    }
    async function enable() {
      if (working.value) return false;
      working.value = true;
      lastError.value = '';
      const token = sequence;
      try {
        if (!supported.value) throw new Error('UNSUPPORTED_AUDIO');
        if (mode.value !== 'speech' && toneSupported) {
          audioContext ??= new (window.AudioContext ?? window.webkitAudioContext)!();
          if (audioContext.state !== 'running') await audioContext.resume();
          if (audioContext.state !== 'running') throw new Error('AUDIO_SUSPENDED');
        }
        if (token !== sequence) return false;
        window.speechSynthesis?.getVoices();
        window.speechSynthesis?.resume();
        unlocked.value = true;
        enabled.value = true;
        persist();
        return true;
      } catch {
        if (token === sequence) { unlocked.value = false; lastError.value = 'sound.unlockFailed'; }
        return false;
      } finally { working.value = false; }
    }
    function disable() { stop(); enabled.value = false; unlocked.value = false; lastError.value = ''; persist(); }
    function setMode(value: SoundMode) {
      if (!['tone', 'speech', 'both'].includes(value)) return;
      stop(); mode.value = value; unlocked.value = false; lastError.value = ''; persist();
    }
    function setVolume(value: number) {
      if (!Number.isFinite(value)) return;
      stop(); volume.value = Math.min(100, Math.max(0, Math.round(value))); persist();
    }
    function ledger(merchantId: string) {
      let entries = ledgers.get(merchantId);
      if (!entries) {
        const stored = readJson(`${prefix}_new_order_seen_v1:${merchantId}`);
        const cutoff = Date.now() - 30 * 86400_000;
        entries = new Map(Object.entries(stored ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > cutoff));
        ledgers.set(merchantId, entries);
      }
      return entries;
    }
    function notifyNewOrders(orders: Array<NewOrderAlert | string>, merchantId: string, authoritative = true) {
      if (!merchantId || (!authoritative && !initializedMerchants.has(merchantId))) return [];
      if (activeMerchant && activeMerchant !== merchantId && !merchantId.startsWith('reservations:')) stop();
      if (!merchantId.startsWith('reservations:')) activeMerchant = merchantId;
      const previous = ledger(merchantId);
      const firstObservation = !initializedMerchants.has(merchantId);
      initializedMerchants.add(merchantId);
      const fresh = new Map<string, NewOrderAlert | null>();
      for (const order of orders) {
        const id = typeof order === 'string' ? order : order.id;
        const key = typeof order === 'string' ? order : order.key ?? order.id;
        if (!id || !key) continue;
        if (!firstObservation && !previous.has(key) && (typeof order === 'string' || order.announce !== false)) fresh.set(id, typeof order === 'string' ? null : order);
        previous.delete(key);
        previous.set(key, Date.now());
      }
      // Accepted/returned orders remain in the ledger so resurfacing does not replay them.
      // Bound persisted history, but retain this session's observed keys. A large current
      // board must not evict its own earlier keys and replay them on every poll.
      writeCashierStorage('local', `${prefix}_new_order_seen_v1:${merchantId}`, JSON.stringify(Object.fromEntries([...previous].slice(-5000))));
      lastNotifiedOrderIds.value = [...fresh.keys()];
      if (active.value) {
        queue.push(...[...fresh.values()].map(order => ({ order, createdAt: Date.now() })));
        void drain();
      }
      return lastNotifiedOrderIds.value;
    }
    async function play(order: NewOrderAlert | null, token: number) {
      if (mode.value !== 'speech' && toneSupported) {
        if (audioContext?.state !== 'running') { unlocked.value = false; lastError.value = 'sound.unlockFailed'; return; }
        const context = audioContext;
        for (const tone of newOrderTones[terminal]) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const start = context.currentTime + tone.start;
          oscillator.type = 'sine';
          oscillator.frequency.value = tone.frequency;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(.22 * volume.value / 100, start + .012);
          gain.gain.exponentialRampToValueAtTime(.001, start + tone.duration);
          oscillator.connect(gain); gain.connect(context.destination);
          oscillators.add(oscillator);
          oscillator.onended = () => { oscillators.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(start); oscillator.stop(start + tone.duration);
        }
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, 520);
          function done() { clearTimeout(timer); if (finishPlayback === done) finishPlayback = undefined; resolve(); }
          finishPlayback = done;
        });
      }
      if (token !== sequence || !active.value || mode.value === 'tone') return;
      if (!speechSupported) { lastError.value = 'sound.speechUnavailable'; return; }
      await new Promise<void>(resolve => {
        const utterance = new window.SpeechSynthesisUtterance(order ? t(newOrderSpeechKey(terminal, order), { table: order.tableNo?.trim() ?? '' }) : t('sound.newOrderSpeech'));
        utterance.lang = speechLanguage(locale.value);
        utterance.rate = .95;
        utterance.volume = volume.value / 100;
        const voice = window.speechSynthesis.getVoices().find(candidate => candidate.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2).toLowerCase()));
        if (voice) utterance.voice = voice;
        speech = utterance;
        const timer = setTimeout(() => { lastError.value = 'sound.speechUnavailable'; window.speechSynthesis.cancel(); done(); }, 12000);
        function done() { clearTimeout(timer); if (speech === utterance) speech = null; if (finishPlayback === done) finishPlayback = undefined; resolve(); }
        utterance.onend = done;
        utterance.onerror = () => { if (token === sequence) lastError.value = 'sound.speechUnavailable'; done(); };
        finishPlayback = done;
        try { window.speechSynthesis.speak(utterance); }
        catch { lastError.value = 'sound.speechUnavailable'; done(); }
      });
    }
    async function drain() {
      if (playing) return;
      playing = true;
      const token = sequence;
      try {
        while (queue.length && active.value && token === sequence) {
          const next = queue.shift()!;
          if (Date.now() - next.createdAt < 30_000) await play(next.order, token);
        }
      } catch { lastError.value = 'sound.unlockFailed'; unlocked.value = false; }
      finally { if (token === sequence) playing = false; }
    }
    async function preview(orderType: NewOrderAlert['orderType'] = 'DINE_IN') {
      stop();
      if (!await enable()) return;
      queue.push({ order: { id: 'preview', orderType, tableNo: '02' }, createdAt: Date.now() });
      await drain();
    }
    function resetMerchant(merchantId?: string) {
      stop(); lastNotifiedOrderIds.value = []; activeMerchant = undefined;
      if (merchantId) initializedMerchants.delete(merchantId); else initializedMerchants.clear();
    }
    watch(locale, () => { stop(); });
    return { terminal, enabled, mode, volume, unlocked, active, supported, working, lastError, lastNotifiedOrderIds,
      enable, disable, setMode, setVolume, notifyNewOrders, resetMerchant, preview, stop };
  });
}
const cashierSound = createSoundStore('cashier');
const kitchenSound = createSoundStore('kds');
export function useSoundStore(terminal: SoundTerminal = isKdsTerminal ? 'kds' : 'cashier') {
  return terminal === 'kds' ? kitchenSound() : cashierSound();
}
function readJson(key: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readCashierStorage('local', key) ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
declare global { interface Window { webkitAudioContext?: typeof AudioContext } }
