<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { waitingMinutes } from '@/domain';
import { useI18n } from '@/i18n';

const props = defineProps<{ createdAt: string; compact?: boolean }>();
const { t } = useI18n();
const now = ref(Date.now());
let timer: number | undefined;
const minutes = computed(() => waitingMinutes(props.createdAt, now.value));
const label = computed(() => minutes.value === null
  ? t('common.notAvailable')
  : minutes.value < 60
    ? t(props.compact ? 'fulfillment.waitMinutesValue' : 'fulfillment.waitMinutes', { minutes: minutes.value })
    : t(props.compact ? 'fulfillment.waitHoursValue' : 'fulfillment.waitHours', {
      hours: Math.floor(minutes.value / 60),
      minutes: minutes.value % 60,
    }));

onMounted(() => {
  timer = window.setInterval(() => { now.value = Date.now(); }, 30_000);
});
onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template><span class="wait-duration">{{ label }}</span></template>
