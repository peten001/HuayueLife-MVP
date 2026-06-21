import { computed, ref } from 'vue';

const PENDING_SNAPSHOT_KEY = 'huayue_merchant_pending_snapshot';
const RECENT_NEW_KEY = 'huayue_merchant_recent_new_orders';
const RECENT_NEW_TTL_MS = 60_000;
const MAX_STORED_IDS = 100;

interface RecentNewOrderRecord {
  id: string;
  expiresAt: number;
}

const soundEnabled = ref(false);
const pendingOrderIds = ref<string[]>(readPendingSnapshot());
const recentNewOrderRecords = ref<RecentNewOrderRecord[]>(readRecentNewRecords());
const initialized = ref(false);
let knownPendingIds = new Set<string>(pendingOrderIds.value);
let audioContext: AudioContext | null = null;

export const pendingOrderCount = computed(() => pendingOrderIds.value.length);
export const orderSoundEnabled = computed(() => soundEnabled.value);
export const recentNewPendingOrderIds = computed(() =>
  recentNewOrderRecords.value.map((record) => record.id),
);

export function isOrderSoundEnabled() {
  return soundEnabled.value;
}

export async function enableOrderSound() {
  await resumeAudioContext();
  void initializeSpeechSynthesis();
  const activated = await speakOrderNotification('声音提醒已开启');
  if (!activated) {
    await initializeSoundPlayback();
  }
  setOrderSoundEnabled(true);
}

export function disableOrderSound() {
  setOrderSoundEnabled(false);
}

export function toggleOrderSound() {
  setOrderSoundEnabled(!soundEnabled.value);
}

export function isRecentNewPendingOrder(id: string) {
  return recentNewPendingOrderIds.value.includes(id);
}

export function clearNewPendingOrder(id: string) {
  clearNewPendingOrders([id]);
}

export function clearNewPendingOrders(ids: string[]) {
  const targetIds = unique(ids);
  if (!targetIds.length) return;
  const targetSet = new Set(targetIds);
  const nextPending = pendingOrderIds.value.filter((id) => !targetSet.has(id));
  pendingOrderIds.value = nextPending;
  knownPendingIds = new Set(nextPending);
  persistPendingSnapshot(nextPending);
  const nextRecent = recentNewOrderRecords.value.filter((record) => !targetSet.has(record.id));
  recentNewOrderRecords.value = nextRecent;
  persistRecentNewOrders(nextRecent);
}

export function notifyNewPendingOrders(ids: string[]) {
  pruneRecentNewOrders();

  const current = unique(ids);
  const currentSet = new Set(current);
  const firstLoad = !initialized.value;
  const newIds = firstLoad
    ? []
    : current.filter((id) => !knownPendingIds.has(id));

  pendingOrderIds.value = current;
  knownPendingIds = currentSet;
  initialized.value = true;
  persistPendingSnapshot(current);

  if (newIds.length) {
    pushRecentNewOrders(newIds);
    if (soundEnabled.value) {
      void speakOrderNotification('你有新的订单啦');
    }
  } else {
    pruneRecentNewOrders();
  }

  syncRecentNewOrders(currentSet);

  return newIds;
}

function pushRecentNewOrders(ids: string[]) {
  const now = Date.now();
  const current = recentNewOrderRecords.value.filter(
    (record) => record.expiresAt > now && !ids.includes(record.id),
  );
  const merged = [
    ...ids.map((id) => ({ id, expiresAt: now + RECENT_NEW_TTL_MS })),
    ...current,
  ];
  recentNewOrderRecords.value = dedupeRecentRecords(merged).slice(0, MAX_STORED_IDS);
  persistRecentNewOrders(recentNewOrderRecords.value);
}

function pruneRecentNewOrders() {
  const now = Date.now();
  const pruned = recentNewOrderRecords.value.filter(
    (record) => record.expiresAt > now,
  );
  if (pruned.length === recentNewOrderRecords.value.length) return;
  recentNewOrderRecords.value = pruned;
  persistRecentNewOrders(pruned);
}

function syncRecentNewOrders(currentSet: Set<string>) {
  const pruned = recentNewOrderRecords.value.filter((record) => currentSet.has(record.id));
  if (pruned.length === recentNewOrderRecords.value.length) return;
  recentNewOrderRecords.value = pruned;
  persistRecentNewOrders(pruned);
}

function dedupeRecentRecords(records: RecentNewOrderRecord[]) {
  const map = new Map<string, RecentNewOrderRecord>();
  for (const record of records) {
    if (!record.id) continue;
    const current = map.get(record.id);
    if (!current || current.expiresAt < record.expiresAt) {
      map.set(record.id, record);
    }
  }
  return [...map.values()].sort((left, right) => right.expiresAt - left.expiresAt);
}

async function speakOrderNotification(text: string) {
  if (typeof window === 'undefined') return false;
  const speech = window.speechSynthesis;
  if (speech && typeof window.SpeechSynthesisUtterance !== 'undefined') {
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.volume = 1;
    utterance.rate = 1;
    utterance.pitch = 1.1;
    const voice = resolveChineseVoice();
    if (voice) utterance.voice = voice;
    speech.cancel();
    speech.speak(utterance);
    return true;
  }
  playFallbackBeep();
  return true;
}

function resolveChineseVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const zhVoices = voices.filter((voice) => /zh/i.test(voice.lang || voice.name));
  if (!zhVoices.length) return voices[0] ?? null;
  const femaleKeywords = ['female', 'xiaoxiao', 'tingting', 'meijia', 'sinji', 'li-mu', '女声'];
  const preferred = zhVoices.find((voice) =>
    femaleKeywords.some((keyword) =>
      `${voice.name} ${voice.lang}`.toLowerCase().includes(keyword.toLowerCase()),
    ),
  );
  return preferred ?? zhVoices[0] ?? voices[0] ?? null;
}

function preloadSpeechSynthesis() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
  void loadVoices();
}

function loadVoices() {
  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      resolve(voices);
      return;
    }
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    }, 1000);
  });
}

function playFallbackBeep() {
  if (typeof window === 'undefined') return;
  const context = getAudioContext();
  if (!context) return;
  if (context.state === 'suspended') {
    void context.resume();
  }

  playBeep(context, 0.12, 0.25);
}

async function resumeAudioContext() {
  const context = getAudioContext();
  if (!context || context.state !== 'suspended') return;
  await context.resume();
}

async function initializeSpeechSynthesis() {
  preloadSpeechSynthesis();
}

function initializeSoundPlayback() {
  const context = getAudioContext();
  if (!context) return;
  playBeep(context, 0.0001, 0.03);
}

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (audioContext) return audioContext;
  const AudioContextClass =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextClass) return null;

  audioContext = new AudioContextClass();
  return audioContext;
}

function playBeep(context: AudioContext, volume: number, duration: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = volume;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

function unique(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function setOrderSoundEnabled(value: boolean) {
  soundEnabled.value = value;
}

function readPendingSnapshot() {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(PENDING_SNAPSHOT_KEY);
    return value ? (JSON.parse(value) as string[]) : [];
  } catch {
    return [];
  }
}

function persistPendingSnapshot(ids: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PENDING_SNAPSHOT_KEY, JSON.stringify(ids.slice(0, MAX_STORED_IDS)));
}

function readRecentNewRecords() {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(RECENT_NEW_KEY);
    const parsed = value ? (JSON.parse(value) as RecentNewOrderRecord[]) : [];
    const now = Date.now();
    return dedupeRecentRecords(parsed).filter((record) => record.expiresAt > now);
  } catch {
    return [];
  }
}

function persistRecentNewOrders(records: RecentNewOrderRecord[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RECENT_NEW_KEY, JSON.stringify(records.slice(0, MAX_STORED_IDS)));
}
