let enabled = false;
let initialized = false;
let knownPendingIds = new Set<string>();

export function isOrderSoundEnabled() {
  return enabled;
}

export async function enableOrderSound() {
  enabled = true;
  await beep(0.05);
}

export function notifyNewPendingOrders(ids: string[]) {
  const current = new Set(ids);
  const hasNew = [...current].some((id) => !knownPendingIds.has(id));
  const shouldNotify = initialized && hasNew;
  knownPendingIds = current;
  initialized = true;
  if (enabled && shouldNotify) {
    void beep(0.25);
  }
}

async function beep(duration: number) {
  const AudioContextClass =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.12;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
  oscillator.addEventListener('ended', () => void context.close());
}
