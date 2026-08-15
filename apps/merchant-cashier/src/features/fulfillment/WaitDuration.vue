<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { waitingMinutes } from '@/domain';
import { useI18n } from '@/i18n';

const props = defineProps<{ createdAt: string; compact?: boolean; endAt?: string }>();
const { t } = useI18n();
const now = ref(Date.now());
let timer: number | undefined;
const minutes = computed(() =>
  props.endAt
    ? waitingMinutes(props.createdAt, Date.parse(props.endAt))
    : waitingMinutes(props.createdAt, now.value),
);
const label = computed(() => minutes.value === null
  ? t('common.notAvailable')
  : minutes.value < 60
    ? t(props.compact || props.endAt ? 'fulfillment.waitMinutesValue' : 'fulfillment.waitMinutes', { minutes: minutes.value })
    : t(props.compact || props.endAt ? 'fulfillment.waitHoursValue' : 'fulfillment.waitHours', {
      hours: Math.floor(minutes.value / 60),
      minutes: minutes.value % 60,
    }));

onMounted(() => {
  if (!props.endAt) {
    timer = window.setInterval(() => { now.value = Date.now(); }, 30_000);
  }
});
onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template><span class="wait-duration">{{ label }}</span></template>
