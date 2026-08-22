<script setup lang="ts">
import Chart from 'chart.js/auto';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  points: Array<{
    label: string;
    settlementCount: number;
    revenueVnd: string;
  }>;
  locale: 'zh' | 'vi' | 'en';
  currency: string;
  revenueLabel: string;
  orderLabel: string;
  ariaLabel: string;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;
let mobileMediaQuery: MediaQueryList | null = null;
let touchCanvas: HTMLCanvasElement | null = null;
let touchInteractionActive = false;

function hideTouchTooltip() {
  if (!chart) return;
  touchInteractionActive = false;
  if (touchCanvas) touchCanvas.dataset.tooltipActive = 'false';
  chart.setActiveElements([]);
  chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
  chart.update('none');
  queueMicrotask(() => {
    if (!chart || touchInteractionActive) return;
    chart.setActiveElements([]);
    chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
    chart.update('none');
  });
}

function updateTouchTooltip(event: TouchEvent) {
  if (!chart || !touchCanvas) return;
  const touch = event.touches[0];
  if (!touch) {
    hideTouchTooltip();
    return;
  }

  const activeElements = chart
    .getElementsAtEventForMode(event, 'index', { intersect: false }, false)
    .map(({ datasetIndex, index }) => ({ datasetIndex, index }));
  if (!activeElements.length) {
    hideTouchTooltip();
    return;
  }

  const bounds = touchCanvas.getBoundingClientRect();
  touchInteractionActive = true;
  touchCanvas.dataset.tooltipActive = 'true';
  chart.setActiveElements(activeElements);
  chart.tooltip?.setActiveElements(activeElements, {
    x: touch.clientX - bounds.left,
    y: touch.clientY - bounds.top,
  });
  chart.update('none');
}

function clearTouchListeners() {
  if (!touchCanvas) return;
  touchCanvas.removeEventListener('touchstart', updateTouchTooltip);
  touchCanvas.removeEventListener('touchmove', updateTouchTooltip);
  touchCanvas.removeEventListener('touchend', hideTouchTooltip);
  touchCanvas.removeEventListener('touchcancel', hideTouchTooltip);
  touchInteractionActive = false;
  touchCanvas = null;
}

function bindTouchListeners(target: HTMLCanvasElement) {
  touchCanvas = target;
  target.dataset.tooltipActive = 'false';
  target.addEventListener('touchstart', updateTouchTooltip, { passive: true });
  target.addEventListener('touchmove', updateTouchTooltip, { passive: true });
  target.addEventListener('touchend', hideTouchTooltip, { passive: true });
  target.addEventListener('touchcancel', hideTouchTooltip, { passive: true });
}

function localeCode() {
  return props.locale === 'vi' ? 'vi-VN' : props.locale === 'en' ? 'en-GB' : 'zh-CN';
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat(localeCode(), {
    style: 'currency',
    currency: props.currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function formatCompact(value: string | number) {
  return new Intl.NumberFormat(localeCode(), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));
}

async function renderChart() {
  await nextTick();
  if (!canvas.value) return;
  clearTouchListeners();
  chart?.destroy();
  const mobile = mobileMediaQuery?.matches ?? window.matchMedia('(max-width: 768px)').matches;
  chart = new Chart(canvas.value, {
    type: 'line',
    data: {
      labels: props.points.map((item) => item.label),
      datasets: [
        {
          label: props.revenueLabel,
          data: props.points.map((item) => Number(item.revenueVnd)),
          yAxisID: 'revenue',
          borderColor: '#2e7d32',
          backgroundColor: 'rgba(67, 160, 71, 0.12)',
          borderWidth: 2.5,
          pointRadius: mobile ? 0 : 2.5,
          pointHoverRadius: 5,
          pointStyle: 'circle',
          fill: true,
          tension: 0.32,
        },
        {
          label: props.orderLabel,
          data: props.points.map((item) => item.settlementCount),
          yAxisID: 'orders',
          borderColor: '#5b8def',
          backgroundColor: '#5b8def',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: mobile ? 0 : 2.5,
          pointHoverRadius: 5,
          pointStyle: 'rectRot',
          fill: false,
          tension: 0.32,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      events: ['mousemove', 'mouseout', 'touchstart', 'touchmove'],
      animation: false,
      plugins: {
        legend: {
          display: !mobile,
          position: 'top',
          align: 'start',
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            color: '#40584a',
            font: { size: 12, weight: 600 },
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.dataset.label ?? '';
              return context.dataset.yAxisID === 'revenue'
                ? `${label}: ${formatCurrency(context.parsed.y)}`
                : `${label}: ${Number(context.parsed.y).toLocaleString(localeCode())}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#5f6d65',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: mobile ? 6 : 10,
            font: { size: mobile ? 9 : 11 },
            callback(value) {
              const label = this.getLabelForValue(Number(value));
              const dateParts = label.split('-');
              return dateParts.length === 3 ? `${dateParts[1]}-${dateParts[2]}` : label;
            },
          },
        },
        revenue: {
          display: !mobile,
          position: 'left',
          beginAtZero: true,
          grid: { color: 'rgba(31, 45, 36, 0.08)' },
          ticks: {
            color: '#5f6d65',
            callback: (value) => formatCompact(value),
          },
        },
        orders: {
          display: !mobile,
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: {
            color: '#5d72a4',
            precision: 0,
          },
        },
      },
    },
  });
  if (mobile) bindTouchListeners(canvas.value);
}

watch(
  () => [props.points, props.locale, props.currency, props.revenueLabel, props.orderLabel],
  () => void renderChart(),
  { deep: true },
);

function handleBreakpointChange() {
  void renderChart();
}

onMounted(() => {
  mobileMediaQuery = window.matchMedia('(max-width: 768px)');
  mobileMediaQuery.addEventListener('change', handleBreakpointChange);
  void renderChart();
});
onBeforeUnmount(() => {
  mobileMediaQuery?.removeEventListener('change', handleBreakpointChange);
  clearTouchListeners();
  chart?.destroy();
});
</script>

<template>
  <div class="business-trend-chart" role="img" :aria-label="ariaLabel">
    <canvas ref="canvas"></canvas>
  </div>
</template>

<style scoped>
/* finesse · register=product · A=incumbent-sage · B=system-sans · C=responsive-line-chart · D=feedback-only · E=dual-metric-trend · SOUL=5 SPECTACLE=1 DENSITY=9 */
.business-trend-chart {
  position: relative;
  width: 100%;
  max-width: 100%;
  height: 196px;
  min-width: 0;
  overflow: hidden;
}

.business-trend-chart canvas {
  display: block;
  max-width: 100% !important;
}

@media (max-width: 900px) {
  .business-trend-chart {
    height: 188px;
  }
}

@media (max-width: 768px) {
  .business-trend-chart {
    height: 126px;
  }
}
</style>
