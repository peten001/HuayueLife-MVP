import { computed, ref } from 'vue';
import { cashierStorageKeys } from '@/config';
import {
  enMessages,
  viMessages,
  zhMessages,
  type TranslationKey,
} from './messages';

export type Locale = 'zh' | 'vi' | 'en';
export type TranslationParams = Record<string, string | number>;

const messages = { zh: zhMessages, vi: viMessages, en: enMessages } as const;
const locale = ref<Locale>(readLocale());

function readLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  const stored = window.localStorage.getItem(cashierStorageKeys.locale);
  return stored === 'vi' || stored === 'en' || stored === 'zh' ? stored : 'zh';
}

function setLocale(nextLocale: Locale) {
  locale.value = nextLocale;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(cashierStorageKeys.locale, nextLocale);
    document.documentElement.lang = nextLocale === 'zh' ? 'zh-CN' : nextLocale;
  }
}

function t(key: TranslationKey | string, params: TranslationParams = {}) {
  const dictionary = messages[locale.value] as Record<string, string>;
  const fallback = zhMessages as Record<string, string>;
  const template = dictionary[key] ?? fallback[key] ?? key;
  return Object.entries(params).reduce(
    (result, [name, value]) => result.split(`{${name}}`).join(String(value)),
    template,
  );
}

export function useI18n() {
  return {
    locale,
    localeName: computed(() => ({ zh: '中文', vi: 'Tiếng Việt', en: 'English' })[locale.value]),
    setLocale,
    t,
  };
}

export { messages, setLocale, t };
export type { TranslationKey };
