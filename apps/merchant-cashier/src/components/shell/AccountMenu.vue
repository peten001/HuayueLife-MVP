<script setup lang="ts">
import { ChevronDown, Languages, LogOut, UserRound } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n, type Locale } from '@/i18n';

const props = defineProps<{
  merchantName?: string;
  role?: string;
  loggingOut?: boolean;
}>();

defineEmits<{
  logout: [];
}>();

const { t, locale, setLocale } = useI18n();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const normalizedRole = computed(() => {
  if (props.role === 'OWNER' || props.role === 'MANAGER' || props.role === 'STAFF') {
    return props.role;
  }
  console.warn('[cashier] Unrecognized merchant role; using the STAFF display fallback.');
  return 'STAFF';
});
const roleLabel = computed(() => {
  if (normalizedRole.value === 'OWNER') return t('auth.role.owner');
  if (normalizedRole.value === 'MANAGER') return t('auth.role.manager');
  return t('auth.role.staff');
});
const roleAccountLabel = computed(() => {
  if (normalizedRole.value === 'OWNER') return t('auth.roleAccount.owner');
  if (normalizedRole.value === 'MANAGER') return t('auth.roleAccount.manager');
  return t('auth.roleAccount.staff');
});

function changeLocale(event: Event) {
  setLocale((event.target as HTMLSelectElement).value as Locale);
}

function closeOnOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false;
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside);
  document.addEventListener('keydown', closeOnEscape);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnOutside);
  document.removeEventListener('keydown', closeOnEscape);
});
</script>

<template>
  <div ref="root" class="account-menu" data-testid="employee-menu">
    <button
      type="button"
      class="account-menu__trigger"
      data-testid="employee-menu-trigger"
      :aria-expanded="open"
      :aria-label="t('account.menu')"
      :title="`${roleLabel} · ${roleAccountLabel}`"
      @click="open = !open"
    >
      <span class="account-menu__avatar" aria-hidden="true"><UserRound :size="18" /></span>
      <span class="account-menu__copy">
        <strong data-testid="account-role-label">{{ roleLabel }}</strong>
        <small data-testid="account-role-account-label">{{ roleAccountLabel }}</small>
      </span>
      <ChevronDown :size="16" aria-hidden="true" />
    </button>

    <section v-if="open" class="account-menu__popover" data-testid="employee-menu-popover">
      <div class="account-menu__compact-identity">
        <strong>{{ merchantName || t('shell.merchantFallback') }}</strong>
        <span>{{ roleLabel }} · {{ roleAccountLabel }}</span>
      </div>
      <label>
        <Languages :size="17" aria-hidden="true" />
        <span>{{ t('account.language') }}</span>
        <select :value="locale" :aria-label="t('account.language')" @change="changeLocale">
          <option value="zh">{{ t('language.zh') }}</option>
          <option value="vi">{{ t('language.vi') }}</option>
          <option value="en">{{ t('language.en') }}</option>
        </select>
      </label>
      <button type="button" :disabled="loggingOut" @click="$emit('logout')">
        <LogOut :size="17" aria-hidden="true" />
        {{ loggingOut ? t('auth.loggingOut') : t('auth.logout') }}
      </button>
    </section>
  </div>
</template>
