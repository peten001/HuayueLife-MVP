<script setup lang="ts">
import Chart from 'chart.js/auto';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  segments: Array<{ key: string; label: string; revenueVnd: string; color: string }>;
  locale: 'zh' | 'vi' | 'en';
  currency: string;
  ariaLabel: string;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

const totalRevenue = computed(() =>
  props.segments.reduce((sum, item) => sum + BigInt(item.revenueVnd), 0n).toString(),
);

function localeCode() {
  return props.locale === 'vi' ? 'vi-VN' : props.locale === 'en' ? 'en-GB' : 'zh-CN';
}

function formatMoney(value: string | number) {
  return `₫${Number(value ?? 0).toLocaleString(localeCode())}`;
}

async function renderChart() {
  await nextTick();
  if (!canvas.value) return;
  chart?.destroy();
  const values = props.segments.map((item) => Number(item.revenueVnd));
  const hasRevenue = values.some((value) => value > 0);
  chart = new Chart(canvas.value, {
    type: 'doughnut',
    data: {
      labels: hasRevenue ? props.segments.map((item) => item.label) : [''],
      datasets: [
        {
          data: hasRevenue ? values : [1],
          backgroundColor: hasRevenue ? props.segments.map((item) => item.color) : ['#edf2ee'],
          borderWidth: 0,
          hoverOffset: hasRevenue ? 3 : 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: hasRevenue,
          callbacks: {
            label(context) {
              return `${context.label}: ${formatMoney(context.parsed)}`;
            },
          },
        },
      },
    },
  });
}

watch(
  () => [props.segments, props.locale, props.currency],
  () => void renderChart(),
  { deep: true },
);

onMounted(() => void renderChart());
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <div class="business-time-chart" role="img" :aria-label="ariaLabel">
    <canvas ref="canvas"></canvas>
    <div class="business-time-chart__center" :title="formatMoney(totalRevenue)" aria-hidden="true">
      <span>{{ locale === 'vi' ? 'Doanh thu' : locale === 'en' ? 'Revenue' : '营业额' }}</span>
      <strong>{{ formatMoney(totalRevenue) }}</strong>
    </div>
  </div>
</template>

<style scoped>
.business-time-chart {
  position: relative;
  width: 100%;
  height: 158px;
  min-width: 0;
}

.business-time-chart__center {
  position: absolute;
  inset: 50% auto auto 50%;
  display: grid;
  width: 94px;
  gap: 3px;
  transform: translate(-50%, -50%);
  color: #5f6d65;
  font-size: 10px;
  text-align: center;
  pointer-events: none;
}

.business-time-chart__center strong {
  overflow: hidden;
  color: #213c2a;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .business-time-chart {
    height: 142px;
  }

  .business-time-chart__center {
    width: 106px;
  }

  .business-time-chart__center strong {
    font-size: 12px;
  }
}
</style>
