<script setup lang="ts">
import { BellRing, X } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { useOrderPush } from '@/composables/useOrderPush';
import { useI18n } from '@/i18n';

const { locale, t } = useI18n();
const push = useOrderPush(locale);
const dismissed = ref(false);
const messageKey = computed(() => ({
  'install-required': 'orderPush.installRequired',
  denied: 'orderPush.denied',
  unavailable: 'orderPush.unavailable',
  error: 'orderPush.error',
} as Record<string, string>)[push.state.value] || 'orderPush.description');

onMounted(() => void push.refresh());

async function turnOn() {
  await push.enable();
  if (push.state.value === 'enabled') dismissed.value = false;
}

defineExpose({ disable: push.disable });
</script>

<template>
  <aside
    v-if="!dismissed && push.state.value !== 'checking' && push.state.value !== 'unsupported'"
    class="order-push-control"
    :class="{ 'order-push-control--enabled': push.state.value === 'enabled' }"
    role="status"
  >
    <BellRing :size="19" aria-hidden="true" />
    <div class="order-push-control__copy">
      <strong>{{ t(push.state.value === 'enabled' ? 'orderPush.enabled' : 'orderPush.title') }}</strong>
      <span v-if="push.state.value !== 'enabled'">{{ t(messageKey) }}</span>
    </div>
    <button
      v-if="push.state.value === 'disabled' || push.state.value === 'error'"
      class="order-push-control__action"
      type="button"
      :disabled="push.working.value"
      @click="turnOn"
    >{{ t(push.working.value ? 'orderPush.working' : push.state.value === 'error' ? 'orderPush.retry' : 'orderPush.enable') }}</button>
    <button
      v-else-if="push.state.value === 'enabled'"
      class="order-push-control__secondary"
      type="button"
      :disabled="push.working.value"
      @click="push.disable"
    >{{ t('orderPush.disable') }}</button>
    <button
      v-if="push.state.value !== 'enabled'"
      class="order-push-control__close"
      type="button"
      :aria-label="t('common.close')"
      @click="dismissed = true"
    ><X :size="16" aria-hidden="true" /></button>
  </aside>
</template>

<style scoped>
.order-push-control {
  position: fixed;
  z-index: 82;
  top: calc(88px + env(safe-area-inset-top));
  right: 16px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: min(360px, calc(100vw - 32px));
  padding: 14px;
  border: 1px solid #cfe6d8;
  border-radius: 16px;
  color: #204231;
  background: #f6fff8;
  box-shadow: 0 14px 36px rgb(7 38 22 / 17%);
}
.order-push-control--enabled { width: auto; align-items: center; padding: 9px 12px; }
.order-push-control__copy { display: grid; flex: 1; gap: 3px; font-size: 12px; line-height: 1.4; }
.order-push-control__copy strong { font-size: 13px; }
.order-push-control__action,
.order-push-control__secondary {
  align-self: center;
  flex: none;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  color: #fff;
  background: #20794a;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.order-push-control__secondary { color: #296143; background: #e7f5eb; }
.order-push-control__close { flex: none; border: 0; color: #557363; background: transparent; }
@media (max-width: 899px) {
  .order-push-control { top: calc(72px + env(safe-area-inset-top)); right: 10px; width: min(350px, calc(100vw - 20px)); }
}
</style>
