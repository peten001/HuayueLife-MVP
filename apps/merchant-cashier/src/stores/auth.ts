import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  changeMerchantPassword,
  getMerchantMe,
  getMerchantProfile,
  loginMerchant,
  messageFromApiError,
} from '@/api';
import { CASHIER_UNAUTHORIZED_EVENT, cashierConfig, cashierStorageKeys } from '@/config';
import {
  activateDemoSession,
  deactivateDemoSession,
  demoRepository,
  resetDemoRepository,
} from '@/fixtures';
import type {
  ChangePasswordPayload,
  MerchantProfile,
  MerchantStaffSession,
} from '@/types';

export const useAuthStore = defineStore('cashier-auth', () => {
  const session = ref<MerchantStaffSession | null>(readStoredSession());
  const profile = ref<MerchantProfile | null>(null);
  const accessToken = ref(readStoredToken());
  const hydrated = ref(false);
  const loading = ref(false);
  const error = ref('');
  const demoMode = ref(false);
  const authExpiredAt = ref<string | null>(null);
  const rememberSession = ref(hasPersistentStoredToken());
  let unauthorizedListenerInstalled = false;
  let hydratePromise: Promise<void> | null = null;

  const isAuthenticated = computed(
    () => demoMode.value || Boolean(accessToken.value && session.value),
  );
  const mustChangePassword = computed(() => Boolean(session.value?.mustChangePassword));
  const merchant = computed(() => session.value?.merchant ?? null);
  const role = computed(() => session.value?.role ?? null);
  const fixturesAvailable = computed(() => cashierConfig.fixturesEnabled);
  const demoLabel = computed(() => cashierConfig.demoLabel);

  function installUnauthorizedListener() {
    if (unauthorizedListenerInstalled || typeof window === 'undefined') return;
    unauthorizedListenerInstalled = true;
    window.addEventListener(CASHIER_UNAUTHORIZED_EVENT, () => {
      authExpiredAt.value = new Date().toISOString();
      clearSession();
    });
  }

  async function hydrate() {
    installUnauthorizedListener();
    if (hydrated.value) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      if (!accessToken.value || !session.value) {
        hydrated.value = true;
        return;
      }
      try {
        const result = await getMerchantMe();
        session.value = sessionFromMe(result);
        persistSession();
        profile.value = await getMerchantProfile();
      } catch (caught) {
        // A 401 event clears the session. A network failure keeps the cached session
        // so the shell can render an explicit offline state.
        error.value = messageFromApiError(caught);
      } finally {
        hydrated.value = true;
      }
    })().finally(() => {
      hydratePromise = null;
    });
    return hydratePromise;
  }

  const restoreSession = hydrate;

  async function login(username: string, password: string, remember = true) {
    loading.value = true;
    error.value = '';
    deactivateDemoSession();
    demoMode.value = false;
    clearSession();
    try {
      const result = await loginMerchant(username, password);
      rememberSession.value = remember;
      accessToken.value = result.accessToken;
      session.value = { ...result.staff, mustChangePassword: Boolean(result.staff.mustChangePassword) };
      persistSession();
      try {
        profile.value = await getMerchantProfile();
      } catch (profileError) {
        error.value = messageFromApiError(profileError);
      }
      hydrated.value = true;
      return session.value;
    } catch (caught) {
      error.value = messageFromApiError(caught);
      clearSession();
      throw caught;
    } finally {
      loading.value = false;
    }
  }

  function enterDemoSession() {
    if (!cashierConfig.fixturesEnabled) throw new Error('Fixture mode is disabled');
    clearSession();
    resetDemoRepository();
    activateDemoSession();
    demoMode.value = true;
    session.value = demoRepository.staff();
    profile.value = demoRepository.profile();
    hydrated.value = true;
    error.value = '';
    return session.value;
  }

  async function changePassword(payload: ChangePasswordPayload) {
    loading.value = true;
    error.value = '';
    try {
      await changeMerchantPassword(payload);
      if (session.value) {
        session.value = { ...session.value, mustChangePassword: false };
        persistSession();
      }
    } catch (caught) {
      error.value = messageFromApiError(caught);
      throw caught;
    } finally {
      loading.value = false;
    }
  }

  async function logout() {
    deactivateDemoSession();
    demoMode.value = false;
    clearSession();
    hydrated.value = true;
  }

  function clearError() {
    error.value = '';
  }

  function clearSession() {
    accessToken.value = '';
    session.value = null;
    profile.value = null;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(cashierStorageKeys.accessToken);
      window.localStorage.removeItem(cashierStorageKeys.staffSession);
      window.sessionStorage.removeItem(cashierStorageKeys.accessToken);
      window.sessionStorage.removeItem(cashierStorageKeys.staffSession);
    }
  }

  function persistSession() {
    if (typeof window === 'undefined' || demoMode.value) return;
    if (!rememberSession.value) {
      window.localStorage.removeItem(cashierStorageKeys.accessToken);
      window.localStorage.removeItem(cashierStorageKeys.staffSession);
      if (accessToken.value) {
        window.sessionStorage.setItem(cashierStorageKeys.accessToken, accessToken.value);
      }
      if (session.value) {
        window.sessionStorage.setItem(
          cashierStorageKeys.staffSession,
          JSON.stringify(session.value),
        );
      }
      return;
    }
    window.sessionStorage.removeItem(cashierStorageKeys.accessToken);
    window.sessionStorage.removeItem(cashierStorageKeys.staffSession);
    if (accessToken.value) {
      window.localStorage.setItem(cashierStorageKeys.accessToken, accessToken.value);
    }
    if (session.value) {
      window.localStorage.setItem(cashierStorageKeys.staffSession, JSON.stringify(session.value));
    }
  }

  return {
    session,
    profile,
    accessToken,
    hydrated,
    loading,
    error,
    demoMode,
    authExpiredAt,
    isAuthenticated,
    mustChangePassword,
    merchant,
    role,
    fixturesAvailable,
    demoLabel,
    rememberSession,
    hydrate,
    restoreSession,
    login,
    enterDemoSession,
    changePassword,
    logout,
    clearError,
  };
});

function readStoredToken() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(cashierStorageKeys.accessToken)
    ?? window.sessionStorage.getItem(cashierStorageKeys.accessToken)
    ?? '';
}

function readStoredSession(): MerchantStaffSession | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(cashierStorageKeys.staffSession)
    ?? window.sessionStorage.getItem(cashierStorageKeys.staffSession);
  if (!value) return null;
  try {
    return JSON.parse(value) as MerchantStaffSession;
  } catch {
    return null;
  }
}

function hasPersistentStoredToken() {
  if (typeof window === 'undefined') return true;
  return Boolean(window.localStorage.getItem(cashierStorageKeys.accessToken));
}

function sessionFromMe(result: Awaited<ReturnType<typeof getMerchantMe>>): MerchantStaffSession {
  return {
    id: result.user.sub,
    username: result.user.username,
    displayName: result.user.username,
    role: result.user.role,
    mustChangePassword: Boolean(result.user.mustChangePassword),
    merchant: result.user.merchant,
  };
}
