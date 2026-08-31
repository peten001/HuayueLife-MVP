<script setup lang="ts">
import {
  Bike,
  Check,
  ChevronDown,
  ChevronRight,
  Globe2,
  History,
  LayoutGrid,
  LogOut,
  ShoppingBag,
  UserRound,
  X,
} from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n, type Locale } from '@/i18n';
import { mobileV2PreviewRouteNames } from './navigation';

const props = withDefaults(defineProps<{
  role?: string;
  loggingOut?: boolean;
  showTables?: boolean;
  showPickup?: boolean;
  showDelivery?: boolean;
}>(), {
  showTables: true,
  showPickup: true,
  showDelivery: true,
});

const emit = defineEmits<{
  close: [];
  logout: [];
}>();

const { t, locale, localeName, setLocale } = useI18n();
const panel = ref<HTMLElement | null>(null);
const languageOpen = ref(false);
const normalizedRole = computed(() => (
  props.role === 'OWNER' || props.role === 'MANAGER' || props.role === 'STAFF'
    ? props.role
    : 'STAFF'
));
const roleLabel = computed(() => t(`auth.role.${normalizedRole.value.toLowerCase()}`));
const roleAccountLabel = computed(() => t(`auth.roleAccount.${normalizedRole.value.toLowerCase()}`));
const destinations = computed(() => [
  ...(props.showTables ? [{ name: mobileV2PreviewRouteNames.tables, label: t('nav.tables'), icon: LayoutGrid }] : []),
  ...(props.showPickup ? [{ name: mobileV2PreviewRouteNames.pickup, label: t('nav.pickup'), icon: ShoppingBag }] : []),
  ...(props.showDelivery ? [{ name: mobileV2PreviewRouteNames.delivery, label: t('nav.delivery'), icon: Bike }] : []),
  { name: mobileV2PreviewRouteNames.history, label: t('nav.history'), icon: History },
]);
const languages = computed(() => [
  { value: 'zh' as const, label: t('language.zh') },
  { value: 'vi' as const, label: t('language.vi') },
  { value: 'en' as const, label: t('language.en') },
]);

function closeOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (languageOpen.value) languageOpen.value = false;
  else emit('close');
}

function selectLanguage(nextLocale: Locale) {
  setLocale(nextLocale);
  languageOpen.value = false;
}

function logout() {
  emit('close');
  emit('logout');
}

onMounted(async () => {
  document.addEventListener('keydown', closeOnEscape);
  await nextTick();
  panel.value?.querySelector<HTMLElement>('a, button')?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', closeOnEscape);
});
</script>

<template>
  <div class="mobile-v2-drawer" data-testid="mobile-v2-drawer">
    <button
      type="button"
      class="mobile-v2-drawer__backdrop"
      :aria-label="t('cashierV2.closeNavigation')"
      @click="emit('close')"
    />
    <aside
      ref="panel"
      class="mobile-v2-drawer__panel"
      role="dialog"
      aria-modal="true"
      :aria-label="t('account.menu')"
    >
      <header class="mobile-v2-drawer__identity">
        <span class="mobile-v2-drawer__avatar" aria-hidden="true"><UserRound :size="24" /></span>
        <div>
          <strong>{{ roleLabel }}</strong>
          <small>{{ roleAccountLabel }}</small>
        </div>
        <button type="button" class="mobile-v2-drawer__close" :aria-label="t('cashierV2.closeNavigation')" @click="emit('close')">
          <X :size="22" aria-hidden="true" />
        </button>
      </header>

      <nav class="mobile-v2-drawer__navigation" :aria-label="t('nav.primary')">
        <RouterLink
          v-for="destination in destinations"
          :key="destination.name"
          :to="{ name: destination.name }"
          @click="emit('close')"
        >
          <component :is="destination.icon" :size="22" :stroke-width="1.9" aria-hidden="true" />
          <span>{{ destination.label }}</span>
          <ChevronRight :size="18" aria-hidden="true" />
        </RouterLink>

        <section class="mobile-v2-drawer__language">
          <button
            type="button"
            class="mobile-v2-drawer__language-trigger"
            :aria-expanded="languageOpen"
            :aria-label="t('account.language')"
            @click="languageOpen = !languageOpen"
          >
            <Globe2 :size="22" :stroke-width="1.9" aria-hidden="true" />
            <span>
              <strong>{{ t('account.language') }}</strong>
              <small>{{ localeName }}</small>
            </span>
            <ChevronDown :size="18" :class="{ 'is-open': languageOpen }" aria-hidden="true" />
          </button>
          <Transition name="mobile-v2-language-options">
            <div v-if="languageOpen" class="mobile-v2-drawer__language-options" role="menu" :aria-label="t('account.language')">
              <button
                v-for="language in languages"
                :key="language.value"
                type="button"
                role="menuitemradio"
                :aria-checked="locale === language.value"
                @click="selectLanguage(language.value)"
              >
                <span>{{ language.label }}</span>
                <Check v-if="locale === language.value" :size="17" aria-hidden="true" />
              </button>
            </div>
          </Transition>
        </section>
      </nav>

      <footer class="mobile-v2-drawer__footer">
        <button type="button" :disabled="loggingOut" @click="logout">
          <LogOut :size="21" aria-hidden="true" />
          <span>{{ loggingOut ? t('auth.loggingOut') : t('auth.logout') }}</span>
        </button>
      </footer>
    </aside>
  </div>
</template>
