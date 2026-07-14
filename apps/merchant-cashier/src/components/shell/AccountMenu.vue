<script setup lang="ts">
import { ChevronDown, ExternalLink, Languages, LogOut, UserRound } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { cashierConfig } from '@/config';
import { useI18n, type Locale } from '@/i18n';

const props = defineProps<{
  staffName?: string;
  role?: string;
  loggingOut?: boolean;
}>();

defineEmits<{
  logout: [];
}>();

const { t, locale, setLocale } = useI18n();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const merchantAdminUrl = cashierConfig.merchantAdminUrl;
const roleLabel = computed(() => {
  if (props.role === 'OWNER') return t('auth.role.owner');
  if (props.role === 'MANAGER') return t('auth.role.manager');
  return t('auth.role.staff');
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
  <div ref="root" class="account-menu">
    <button
      type="button"
      class="account-menu__trigger"
      :aria-expanded="open"
      :aria-label="t('account.menu')"
      @click="open = !open"
    >
      <span class="account-menu__avatar" aria-hidden="true"><UserRound :size="18" /></span>
      <span class="account-menu__copy">
        <strong>{{ staffName || t('shell.staffFallback') }}</strong>
        <small>{{ roleLabel }}</small>
      </span>
      <ChevronDown :size="16" aria-hidden="true" />
    </button>

    <section v-if="open" class="account-menu__popover">
      <a
        :href="merchantAdminUrl"
        target="_blank"
        rel="noopener noreferrer"
        @click="open = false"
      >
        <ExternalLink :size="17" aria-hidden="true" />
        {{ t('account.openMerchantAdmin') }}
      </a>
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
