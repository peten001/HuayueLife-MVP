import { computed, onBeforeUnmount, onMounted, readonly, ref } from 'vue';
import { cashierStorageKeys } from '@/config';

const DISMISS_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const INSTALL_DISMISS_KEY = cashierStorageKeys.pwaInstallPromptDismissedUntil;

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

type InstallOutcome = 'accepted' | 'dismissed' | 'cancelled';

type BeforeInstallPromptEvent = Event & {
  readonly platforms?: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome }>;
};

interface NavigatorLike {
  userAgent?: string;
  standalone?: boolean;
  maxTouchPoints?: number;
}

function now() {
  return Date.now();
}

function safeNumber(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getDisplayModeStandAlone() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return [
    'fullscreen',
    'standalone',
    'minimal-ui',
    'window-controls-overlay',
  ].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
}

function getNavigatorLike() {
  if (typeof navigator === 'undefined') return null;
  return navigator as NavigatorLike;
}

function getDeviceUserAgent() {
  return getNavigatorLike()?.userAgent?.toLowerCase() || '';
}

function parseDismissDays(raw: number) {
  return Number.isFinite(raw) && raw > 0 ? raw : DISMISS_DAYS;
}

function getDismissedUntil(raw: string | null) {
  if (!raw) return 0;
  return safeNumber(raw);
}

function getStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getDismissedUntilNow(key: string) {
  const storage = getStorage();
  if (!storage) return 0;
  return getDismissedUntil(storage.getItem(key));
}

function setDismissedUntil(key: string, value: number | string) {
  const storage = getStorage();
  if (!storage) return;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  storage.setItem(key, String(parsed));
}

function isIosCompatible(userAgent: string) {
  return /iphone|ipod/.test(userAgent)
    || (/ipad/.test(userAgent) && /safari/.test(userAgent));
}

function isStandaloneCapableMacTouchSafari(userAgent: string) {
  const navigatorLike = getNavigatorLike();
  const maxTouchPoints = navigatorLike?.maxTouchPoints || 0;
  return /macintosh/.test(userAgent)
    && /safari/.test(userAgent)
    && /version/.test(userAgent)
    && maxTouchPoints > 1;
}

function isLikelyWebView(userAgent: string) {
  return /applewebkit/.test(userAgent) && /wv/.test(userAgent);
}

export function usePwaInstall() {
  const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
  const installable = ref(false);
  const installRequested = ref(false);
  const bannerDismissed = ref(false);

  const userAgent = getDeviceUserAgent();

  const platformData = computed(() => {
    const isIOS = isIosCompatible(userAgent) || isStandaloneCapableMacTouchSafari(userAgent);
    const isAndroid = /android/.test(userAgent);
    const isAppleWebKit = /applewebkit/.test(userAgent);

    return {
      isMobile: isIOS || isAndroid,
      isIOS,
      isAndroid,
      isWebView: isAppleWebKit && ((isAndroid && /webview/.test(userAgent)) || isLikelyWebView(userAgent)),
      isStandalone: Boolean(getNavigatorLike()?.standalone) || getDisplayModeStandAlone(),
    };
  });

  const isIOS = computed(() => platformData.value.isIOS);
  const isAndroid = computed(() => platformData.value.isAndroid);
  const isMobile = computed(() => platformData.value.isMobile);
  const isWebView = computed(() => platformData.value.isWebView);
  const isWebApp = computed(() => platformData.value.isStandalone);
  const isInstallable = computed(() => isAndroid.value && installable.value);

  const isSuppressed = computed(() => {
    if (typeof window === 'undefined') return false;
    return getDismissedUntilNow(INSTALL_DISMISS_KEY) > now();
  });

  const shouldShowIosPrompt = computed(() => isIOS.value);
  const shouldShowAndroidFallback = computed(() => isAndroid.value && !isInstallable.value);
  const shouldShowBanner = computed(() =>
    !isWebApp.value
    && isMobile.value
    && !isWebView.value
    && !isSuppressed.value
    && !bannerDismissed.value
    && (shouldShowIosPrompt.value || isInstallable.value || shouldShowAndroidFallback.value)
  );

  async function installWithPrompt() {
    if (!deferredPrompt.value) return;
    const prompt = deferredPrompt.value;
    installRequested.value = true;
    deferredPrompt.value = null;
    installable.value = false;

    await prompt.prompt();
    const result = await prompt.userChoice;
    installRequested.value = false;
    setDismissedUntil(INSTALL_DISMISS_KEY, now() + (parseDismissDays(result.outcome === 'accepted' ? 365 : 3) * MS_PER_DAY));
  }

  function dismissBanner() {
    bannerDismissed.value = true;
    setDismissedUntil(INSTALL_DISMISS_KEY, now() + (parseDismissDays(DISMISS_DAYS) * MS_PER_DAY));
  }

  function handleBeforeInstallPrompt(event: Event) {
    if (installRequested.value) return;
    event.preventDefault();
    deferredPrompt.value = event as BeforeInstallPromptEvent;
    installable.value = true;
  }

  function handleAppInstalled() {
    setDismissedUntil(INSTALL_DISMISS_KEY, now() + (parseDismissDays(365) * MS_PER_DAY));
    deferredPrompt.value = null;
    installable.value = false;
  }

  onMounted(() => {
    if (typeof window === 'undefined') return;
    if (!isSuppressed.value && isAndroid.value) {
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    }
    window.addEventListener('appinstalled', handleAppInstalled);
  });

  onBeforeUnmount(() => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    window.removeEventListener('appinstalled', handleAppInstalled);
  });

  return {
    isIOS: readonly(isIOS),
    isAndroid: readonly(isAndroid),
    isWebView: readonly(isWebView),
    isWebApp: readonly(isWebApp),
    isMobile: readonly(isMobile),
    installable: readonly(installable),
    shouldShowBanner: readonly(shouldShowBanner),
    shouldShowAndroidFallback: readonly(shouldShowAndroidFallback),
    shouldShowIosPrompt: readonly(shouldShowIosPrompt),
    installWithPrompt,
    dismissBanner,
    isInstallable: readonly(isInstallable),
  };
}
