<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    values: number[];
    color?: string;
    ariaLabel: string;
  }>(),
  { color: '#2f9e44' },
);

const points = computed(() => {
  const values = props.values.length > 1 ? props.values : [props.values[0] ?? 0, props.values[0] ?? 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = 3 + (index / (values.length - 1)) * 114;
      const y = 31 - ((value - min) / range) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
});

const area = computed(() => `3,34 ${points.value} 117,34`);
</script>

<template>
  <svg class="business-sparkline" viewBox="0 0 120 36" role="img" :aria-label="ariaLabel">
    <polygon :points="area" :fill="color" fill-opacity="0.12" />
    <polyline :points="points" fill="none" :stroke="color" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.business-sparkline {
  display: block;
  width: 100%;
  height: 36px;
  overflow: visible;
}
</style>
