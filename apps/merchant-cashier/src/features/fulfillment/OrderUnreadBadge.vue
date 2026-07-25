<script setup lang="ts">
import { MessageCircle } from '@lucide/vue';
import { useI18n } from '@/i18n';

defineProps<{ count?: number }>();
const { t } = useI18n();
</script>

<template>
  <span v-if="Number(count || 0) > 0" class="order-unread-badge" :aria-label="t('fulfillment.unreadCount', { count: count || 0 })">
    <MessageCircle :size="14" aria-hidden="true" />{{ Number(count) > 99 ? t('common.countOverflow') : count }}
  </span>
</template>
