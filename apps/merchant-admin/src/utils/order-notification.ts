import { computed, ref } from 'vue';

const PENDING_SNAPSHOT_KEY = 'huayue_merchant_pending_snapshot';
const RECENT_NEW_KEY = 'huayue_merchant_recent_new_orders';
const RECENT_NEW_TTL_MS = 60_000;
const MAX_STORED_IDS = 100;
const ENABLE_SOUND_AUDIO_URL = `${import.meta.env.BASE_URL}order-sound-enabled.wav`;
const NEW_ORDER_AUDIO_URL = `${import.meta.env.BASE_URL}new-order.wav`;

interface RecentNewOrderRecord {
  id: string;
  expiresAt: number;
}

interface AudioDebugLogEntry {
  time: string;
  message: string;
  details?: string;
}

type SpeakDebugState = 'success' | 'failed' | 'not-called';
type PlaybackResult = 'audio' | 'beep' | 'speech' | 'failed';
type DebugOrderReason = 'enable-sound' | 'new-order' | 'debug-test' | 'debug-unlock';

const soundEnabled = ref(false);
const pendingOrderIds = ref<string[]>(readPendingSnapshot());
const recentNewOrderRecords = ref<RecentNewOrderRecord[]>(readRecentNewRecords());
const initialized = ref(false);
const speechVoicesCount = ref(getCurrentSpeechVoicesCount());
const lastSpeakState = ref<SpeakDebugState>('not-called');
const lastSpeakReason = ref('not-called');
const audioDebugLogs = ref<AudioDebugLogEntry[]>([]);
const speechSupported = ref(isSpeechSynthesisSupported());
const speechSpeakCalled = ref('not-called');
const speechSelectedVoiceName = ref('not-selected');
const speechSelectedVoiceLang = ref('not-selected');
const speechUtteranceState = ref('idle');
const speechUtteranceError = ref('not-called');
const speechUnlocked = ref(false);
const speechRuntimeSpeaking = ref('false');
const speechRuntimePending = ref('false');
const speechRuntimePaused = ref('false');
const speechRuntimeSnapshotAfterDelay = ref('not-recorded');
let knownPendingIds = new Set<string>(pendingOrderIds.value);
let audioContext: AudioContext | null = null;
const notificationAudioCache = new Map<string, HTMLAudioElement>();

export const pendingOrderCount = computed(() => pendingOrderIds.value.length);
export const orderSoundEnabled = computed(() => soundEnabled.value);
export const audioContextDebugState = computed(() => audioContext?.state ?? 'not-created');
export const speechVoicesDebugCount = computed(() => speechVoicesCount.value);
export const lastSpeakDebugState = computed(() => lastSpeakState.value);
export const lastSpeakDebugReason = computed(() => lastSpeakReason.value);
export const lastSpeakDebugSummary = computed(() =>
  lastSpeakState.value === 'failed'
    ? `failed${lastSpeakReason.value ? `: ${lastSpeakReason.value}` : ''}`
    : lastSpeakState.value,
);
export const speechSynthesisSupportedDebug = computed(() =>
  speechSupported.value ? 'true' : 'false',
);
export const speechSelectedVoiceDebugName = computed(() => speechSelectedVoiceName.value);
export const speechSelectedVoiceDebugLang = computed(() => speechSelectedVoiceLang.value);
export const speechSpeakCalledDebug = computed(() => speechSpeakCalled.value);
export const speechUtteranceStateDebug = computed(() => speechUtteranceState.value);
export const speechUtteranceErrorDebug = computed(() => speechUtteranceError.value);
export const speechUnlockedDebug = computed(() => (speechUnlocked.value ? 'true' : 'false'));
export const speechRuntimeSpeakingDebug = computed(() => speechRuntimeSpeaking.value);
export const speechRuntimePendingDebug = computed(() => speechRuntimePending.value);
export const speechRuntimePausedDebug = computed(() => speechRuntimePaused.value);
export const speechRuntimeSnapshotAfterDelayDebug = computed(() => speechRuntimeSnapshotAfterDelay.value);
export const orderAudioDebugLogs = computed(() => audioDebugLogs.value.slice(0, 20));
export const recentNewPendingOrderIds = computed(() =>
  recentNewOrderRecords.value.map((record) => record.id),
);

export function isOrderSoundEnabled() {
  return soundEnabled.value;
}

export async function enableOrderSound() {
  pushAudioDebugLog('点击开启声音提醒', { soundEnabled: soundEnabled.value });
  preloadSpeechSynthesis();
  const result = speakOrderNotification('声音提醒已开启', 'enable-sound');
  pushAudioDebugLog('开启声音提醒完成', {
    result,
    soundEnabled: soundEnabled.value,
  });
  pushAudioDebugLog('soundEnabled 最终状态', { value: soundEnabled.value, result });
  return soundEnabled.value;
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
  pushAudioDebugLog('notifyNewPendingOrders called', {
    incomingIds: ids,
    soundEnabled: soundEnabled.value,
  });

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
    pushAudioDebugLog('notifyNewPendingOrders newPendingIds', {
      newIds,
      firstLoad,
    });
    pushRecentNewOrders(newIds);
    if (soundEnabled.value) {
      const result = speakOrderNotification('您有新的订单', 'new-order');
      pushAudioDebugLog('notifyNewPendingOrders speech trigger', {
        result,
        speechUnlocked: speechUnlocked.value,
      });
    }
  } else {
    pruneRecentNewOrders();
  }

  syncRecentNewOrders(currentSet);

  pushAudioDebugLog('notifyNewPendingOrders result', {
    totalOrders: current.length,
    pendingOrders: current.length,
    newPendingIds: newIds,
  });

  return newIds;
}

export async function debugPlayNewOrderSound() {
  pushAudioDebugLog('测试播放新订单声音', {
    soundEnabled: soundEnabled.value,
  });
  return speakOrderNotification('您有新的订单', 'debug-test');
}

export function debugUnlockSpeechPlayback() {
  pushAudioDebugLog('解锁语音播报', {
    speechUnlocked: speechUnlocked.value,
  });
  return playSpeechAnnouncementNow('语音播报已解锁', 'debug-unlock');
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

function speakOrderNotification(
  text: string,
  reason: DebugOrderReason,
): PlaybackResult {
  const beepOk = playOrderBeep(reason);
  if (beepOk) {
    if (reason === 'enable-sound' && !soundEnabled.value) {
      setOrderSoundEnabled(true);
      pushAudioDebugLog('soundEnabled 已开启', { value: true, reason });
    }
    setLastSpeakDebugState('success');
    pushAudioDebugLog('fallback beep success', { text, reason });
    if (reason === 'enable-sound') {
      void playSpeechAnnouncementNow('已开启', reason);
    } else if (speechUnlocked.value) {
      void playSpeechAnnouncementNow(text, reason);
    } else {
      pushAudioDebugLog('speech skipped until unlocked', { text, reason, speechUnlocked: false });
    }
    return 'beep';
  }

  if (speechUnlocked.value) {
    void playSpeechAnnouncementNow(text, reason);
    setLastSpeakDebugState('success');
    pushAudioDebugLog('speech triggered without beep', { text, reason });
    return 'speech';
  }

  const audioUrl = resolveNotificationAudioUrl(text);
  if (audioUrl && playNotificationAudio(audioUrl)) {
    setLastSpeakDebugState('success');
    pushAudioDebugLog('speakOrderNotification audio success', { text, reason, audioUrl });
    return 'audio';
  }

  setLastSpeakDebugState('failed', 'notification playback failed');
  pushAudioDebugLog('notification playback failed', { text, reason });
  return 'failed';
}

function resolveNotificationAudioUrl(text: string) {
  if (text === '声音提醒已开启') return ENABLE_SOUND_AUDIO_URL;
  if (text === '您有新的订单' || text === '你有新的订单啦') return NEW_ORDER_AUDIO_URL;
  return null;
}

function playOrderBeep(reason: DebugOrderReason) {
  const context = getAudioContext();
  if (!context) {
    pushAudioDebugLog('fallback beep failed', { reason, error: 'audio context unavailable' });
    return false;
  }
  try {
    void resumeAudioContext();
    playBeep(context, 0.08, 0.05);
    if (context.state === 'suspended') {
      pushAudioDebugLog('fallback beep pending resume', { reason, contextState: context.state });
    }
    return true;
  } catch (error) {
    setLastSpeakDebugState('failed', stringifyError(error));
    pushAudioDebugLog('fallback beep failed', {
      reason,
      error: stringifyError(error),
    });
    return false;
  }
}

function playSpeechAnnouncementNow(text: string, reason: DebugOrderReason) {
  if (typeof window === 'undefined') {
    setLastSpeakDebugState('failed', 'window unavailable');
    pushAudioDebugLog('speechSynthesis unavailable', { text, reason });
    speechUtteranceState.value = 'onerror';
    speechUtteranceError.value = 'window unavailable';
    return false;
  }
  speechSupported.value = isSpeechSynthesisSupported();
  const speech = window.speechSynthesis;
  if (!speech || typeof window.SpeechSynthesisUtterance === 'undefined') {
    setLastSpeakDebugState('failed', 'speechSynthesis unavailable');
    pushAudioDebugLog('speechSynthesis unavailable for speak', { text, reason });
    speechSpeakCalled.value = 'not-called';
    speechUtteranceState.value = 'onerror';
    speechUtteranceError.value = 'speechSynthesis unavailable';
    return false;
  }

  try {
    updateSpeechRuntimeSnapshot(speech);
    speech.cancel();
    pushAudioDebugLog('speech cancel before speak', {
      text,
      reason,
      speaking: speech.speaking,
      pending: speech.pending,
      paused: speech.paused,
    });
    const utterance = new window.SpeechSynthesisUtterance(text);
    const voice = resolveChineseVoice();
    const attachVoice = !!voice && !isIosSafariLike();
    speechSpeakCalled.value = 'called';
    speechUtteranceState.value = 'queued';
    speechSelectedVoiceName.value = voice?.name || 'not-selected';
    speechSelectedVoiceLang.value = voice?.lang || 'not-selected';
    utterance.lang = 'zh-CN';
    utterance.volume = 1;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    if (attachVoice && voice) {
      utterance.voice = voice;
    }
    utterance.onstart = () => {
      speechUnlocked.value = true;
      speechUtteranceState.value = 'onstart';
      updateSpeechRuntimeSnapshot(speech);
      pushAudioDebugLog('utterance onstart', {
        text,
        reason,
        voice: voiceSummary(voice),
      });
    };
    utterance.onend = () => {
      speechUnlocked.value = true;
      speechUtteranceState.value = 'onend';
      updateSpeechRuntimeSnapshot(speech);
      pushAudioDebugLog('utterance onend', {
        text,
        reason,
        voice: voiceSummary(voice),
      });
    };
    utterance.onerror = (event) => {
      speechUtteranceState.value = 'onerror';
      const errorName = (event as SpeechSynthesisErrorEvent).error || 'unknown';
      speechUtteranceError.value = errorName;
      updateSpeechRuntimeSnapshot(speech);
      pushAudioDebugLog('utterance onerror', {
        text,
        reason,
        error: errorName,
        voice: voiceSummary(voice),
      });
    };
    if (typeof speech.resume === 'function') {
      speech.resume();
    }
    speech.speak(utterance);
    updateSpeechRuntimeSnapshot(speech);
    pushAudioDebugLog('speechSynthesis speak called', {
      text,
      reason,
      selectedVoice: voiceSummary(voice),
      attachVoice,
    });
    window.setTimeout(() => {
      updateSpeechRuntimeSnapshot(speech);
      const snapshot = buildSpeechRuntimeSnapshot(speech);
      speechRuntimeSnapshotAfterDelay.value = snapshot;
      pushAudioDebugLog('speech state after 2000ms', {
        text,
        reason,
        snapshot,
      });
    }, 2000);
    return true;
  } catch (error) {
    speechUtteranceState.value = 'onerror';
    speechUtteranceError.value = stringifyError(error);
    updateSpeechRuntimeSnapshot(speech);
    pushAudioDebugLog('speechSynthesis speak failed', {
      text,
      reason,
      error: stringifyError(error),
    });
    return false;
  }
}

function playNotificationAudio(url: string) {
  if (typeof window === 'undefined') return false;
  try {
    const wasCached = notificationAudioCache.has(url);
    const audio = getCachedNotificationAudio(url);
    pushAudioDebugLog('audio create or reuse', {
      src: audio.src,
      cached: wasCached,
      readyState: audio.readyState,
    });
    try {
      audio.pause();
      audio.currentTime = 0;
      pushAudioDebugLog('audio prepared', { src: audio.src, currentTime: audio.currentTime });
    } catch (error) {
      pushAudioDebugLog('audio prepare failed', {
        src: audio.src,
        error: stringifyError(error),
      });
    }
    void audio
      .play()
      .then(() => {
        pushAudioDebugLog('audio play success', { src: audio.src });
        return undefined;
      })
      .catch((error: unknown) => {
        const err = error as Error & { name?: string };
        pushAudioDebugLog('audio play failed', {
          src: audio.src,
          errorName: err?.name ?? 'unknown',
          errorMessage: err?.message ?? String(error),
        });
        throw error;
      });
    return true;
  } catch (error) {
    pushAudioDebugLog('audio playback failed, falling back', {
      url,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
    return false;
  }
}

function getCachedNotificationAudio(url: string) {
  const cached = notificationAudioCache.get(url);
  if (cached) return cached;

  const audio = new window.Audio(url);
  audio.preload = 'auto';
  audio.setAttribute('playsinline', 'true');
  audio.volume = 1;
  notificationAudioCache.set(url, audio);
  return audio;
}

async function speakWithSpeechSynthesis(
  text: string,
  reason: DebugOrderReason,
): Promise<PlaybackResult> {
  if (typeof window === 'undefined') {
    setLastSpeakDebugState('failed', 'window unavailable');
    pushAudioDebugLog('speechSynthesis unavailable', { text });
    speechSpeakCalled.value = 'not-called';
    return 'failed';
  }
  speechSupported.value = isSpeechSynthesisSupported();
  const speech = window.speechSynthesis;
  if (!speech || typeof window.SpeechSynthesisUtterance === 'undefined') {
    setLastSpeakDebugState('failed', 'speechSynthesis unavailable');
    pushAudioDebugLog('speechSynthesis unavailable for speak', { text });
    speechSpeakCalled.value = 'not-called';
    return 'failed';
  }
  try {
    await loadVoices();
    const voice = resolveChineseVoice();
    speechSelectedVoiceName.value = voice?.name || 'not-selected';
    speechSelectedVoiceLang.value = voice?.lang || 'not-selected';
    const attachVoice = !!voice && !isIosSafariLike();
    speechSpeakCalled.value = 'called';
    speechUtteranceState.value = 'queued';
    pushAudioDebugLog('speech voice selected', {
      text,
      reason,
      selectedVoice: voiceSummary(voice),
      attachVoice,
    });
    updateSpeechRuntimeSnapshot(speech);
    if (speech.speaking || speech.pending) {
      speech.cancel();
    }
    pushAudioDebugLog('speech cancel before speak', {
      text,
      reason,
      speaking: speech.speaking,
      pending: speech.pending,
      paused: speech.paused,
    });
    try {
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.volume = 1;
      utterance.rate = 0.9;
      utterance.pitch = 1;
      if (attachVoice && voice) {
        utterance.voice = voice;
      }
      utterance.onstart = () => {
        speechUnlocked.value = true;
        speechUtteranceState.value = 'onstart';
        pushAudioDebugLog('utterance onstart', { text, reason, voice: voiceSummary(voice) });
        updateSpeechRuntimeSnapshot(speech);
      };
      utterance.onend = () => {
        speechUnlocked.value = true;
        speechUtteranceState.value = 'onend';
        pushAudioDebugLog('utterance onend', { text, reason, voice: voiceSummary(voice) });
        updateSpeechRuntimeSnapshot(speech);
      };
      utterance.onerror = (event) => {
        speechUtteranceState.value = 'onerror';
        const errorName = (event as SpeechSynthesisErrorEvent).error || 'unknown';
        speechUtteranceError.value = errorName;
        pushAudioDebugLog('utterance onerror', {
          text,
          reason,
          error: errorName,
          voice: voiceSummary(voice),
        });
        updateSpeechRuntimeSnapshot(speech);
      };
      if (typeof speech.resume === 'function') {
        speech.resume();
      }
      speech.speak(utterance);
      updateSpeechRuntimeSnapshot(speech);
      pushAudioDebugLog('speechSynthesis speak called', {
        text,
        reason,
        selectedVoice: voiceSummary(voice),
        attachVoice,
      });
      window.setTimeout(() => {
        updateSpeechRuntimeSnapshot(speech);
      const snapshot = buildSpeechRuntimeSnapshot(speech);
      speechRuntimeSnapshotAfterDelay.value = snapshot;
      pushAudioDebugLog('speech state after 2000ms', {
        text,
        reason,
        snapshot,
      });
      }, 2000);
    } catch (error) {
      speechUtteranceState.value = 'onerror';
      speechUtteranceError.value = stringifyError(error);
      pushAudioDebugLog('speechSynthesis speak failed', {
        text,
        reason,
        error: stringifyError(error),
      });
    }
    return 'speech';
  } catch (error) {
    setLastSpeakDebugState('failed', stringifyError(error));
    speechSpeakCalled.value = 'called';
    speechUtteranceState.value = 'onerror';
    speechUtteranceError.value = stringifyError(error);
    pushAudioDebugLog('speechSynthesis speak failed', {
      text,
      error: stringifyError(error),
    });
    return 'failed';
  }
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
  speechSupported.value = isSpeechSynthesisSupported();
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  updateSpeechVoicesCount(window.speechSynthesis.getVoices());
  updateSpeechRuntimeSnapshot(window.speechSynthesis);
  void loadVoices();
}

async function unlockAudioForReminder() {
  const context = getAudioContext();
  if (!context) return false;
  try {
    await resumeAudioContext();
    playBeep(context, 0.08, 0.05);
    pushAudioDebugLog('fallback beep success', {
      contextState: context.state,
    });
    return true;
  } catch (error) {
    setLastSpeakDebugState('failed', stringifyError(error));
    pushAudioDebugLog('fallback beep failed', {
      error: stringifyError(error),
    });
    return false;
  }
}

function loadVoices() {
  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      speechSupported.value = false;
      updateSpeechVoicesCount([]);
      resolve([]);
      return;
    }
    speechSupported.value = true;
    const voices = window.speechSynthesis.getVoices();
    updateSpeechVoicesCount(voices);
    if (voices.length) {
      resolve(voices);
      return;
    }
    let settled = false;
    let handler: () => void = () => {};
    const finish = (nextVoices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      updateSpeechVoicesCount(nextVoices);
      updateSpeechRuntimeSnapshot(window.speechSynthesis);
      pushAudioDebugLog('voiceschanged', {
        voicesLength: nextVoices.length,
      });
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(nextVoices);
    };
    handler = () => {
      finish(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    window.setTimeout(() => {
      finish(window.speechSynthesis.getVoices());
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

function setLastSpeakDebugState(state: SpeakDebugState, reason = '') {
  lastSpeakState.value = state;
  lastSpeakReason.value = state === 'failed' ? reason || 'unknown error' : '';
}

export function pushAudioDebugLog(message: string, details?: unknown) {
  const entry: AudioDebugLogEntry = {
    time: new Date().toLocaleTimeString(),
    message,
  };
  if (typeof details !== 'undefined') {
    entry.details = formatAudioDebugDetails(details);
  }
  audioDebugLogs.value = [entry, ...audioDebugLogs.value].slice(0, 20);
}

export function clearAudioDebugLogs() {
  audioDebugLogs.value = [];
}

function formatAudioDebugDetails(details: unknown) {
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function isSpeechSynthesisSupported() {
  return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance !== 'undefined';
}

function updateSpeechRuntimeSnapshot(speech?: SpeechSynthesis) {
  if (!speech) {
    speechRuntimeSpeaking.value = 'false';
    speechRuntimePending.value = 'false';
    speechRuntimePaused.value = 'false';
    return;
  }
  speechRuntimeSpeaking.value = String(speech.speaking);
  speechRuntimePending.value = String(speech.pending);
  speechRuntimePaused.value = String(speech.paused);
}

function buildSpeechRuntimeSnapshot(speech?: SpeechSynthesis) {
  if (!speech) {
    return 'speaking=false pending=false paused=false';
  }
  return `speaking=${String(speech.speaking)} pending=${String(speech.pending)} paused=${String(speech.paused)}`;
}

function voiceSummary(voice: SpeechSynthesisVoice | null) {
  if (!voice) return 'not-selected';
  return `${voice.name || 'unknown'} / ${voice.lang || 'unknown'}`;
}

function isIosSafariLike() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|od|ad)/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return isIOS && isSafari;
}

function updateSpeechVoicesCount(voices: SpeechSynthesisVoice[]) {
  speechVoicesCount.value = voices.length;
}

function getCurrentSpeechVoicesCount() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return 0;
  return window.speechSynthesis.getVoices().length;
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message || error.name || 'unknown error';
  return typeof error === 'string' ? error : 'unknown error';
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
