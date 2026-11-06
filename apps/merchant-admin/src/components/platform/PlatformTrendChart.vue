<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from "chart.js";
import { platformMoney } from "@/utils/platform-format";
import { usePlatformLocale } from "@/composables/usePlatformLocale";
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
);
const props = defineProps<{
  rows: Array<{
    date: string;
    orderAmount: string | null;
    orderCount: number | null;
  }>;
  previous?: Array<{
    date: string;
    orderAmount: string | null;
    orderCount: number | null;
  }>;
  metric: "amount" | "count";
}>();
const emit = defineEmits<{ drill: [date: string] }>();
const canvas = ref<HTMLCanvasElement>();
const { t, locale } = usePlatformLocale();
let chart: Chart<"line"> | undefined;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
function render() {
  if (!canvas.value) return;
  chart?.destroy();
  const value = (row: (typeof props.rows)[number]) =>
    props.metric === "amount"
      ? row.orderAmount === null
        ? null
        : Number(row.orderAmount) / 1000000
      : row.orderCount;
  chart = new Chart(canvas.value, {
    type: "line",
    data: {
      labels: props.rows.map((row) =>
        row.date.includes("T") ? row.date.slice(11, 16) : row.date.slice(5),
      ),
      datasets: [
        {
          label: t("本期"),
          data: props.rows.map(value),
          borderColor: "#416bd8",
          backgroundColor: "#416bd8",
          borderWidth: 2,
          pointRadius: props.rows.length > 31 ? 0 : 3,
          pointHoverRadius: 5,
          tension: 0.25,
          fill: false,
        },
        {
          label: t("上期"),
          data: (props.previous || []).map(value),
          borderColor: "#b7bfcc",
          backgroundColor: "#b7bfcc",
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduced.matches ? false : { duration: 540 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          align: "end",
          labels: {
            usePointStyle: true,
            pointStyle: "line",
            boxWidth: 24,
            padding: 24,
            color: "#8a93a2",
            font: { size: 11 },
          },
        },
        tooltip: {
          backgroundColor: "#222936",
          padding: 12,
          displayColors: true,
          callbacks: {
            title: (items) => {
              const i = items[0]?.dataIndex;
              return i === undefined ? "" : props.rows[i].date;
            },
            label: (ctx) => {
              const row =
                ctx.datasetIndex === 0
                  ? props.rows[ctx.dataIndex]
                  : props.previous?.[ctx.dataIndex];
              return `${ctx.datasetIndex ? t("上期") : t("本期")} ${ctx.datasetIndex && row ? `${row.date} · ` : ""}${row ? (props.metric === "amount" ? platformMoney(row.orderAmount) : row.orderCount === null ? "—" : row.orderCount.toLocaleString()) : "—"}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: "#8a93a2",
            font: { size: 11 },
            maxTicksLimit: 12,
            maxRotation: 0,
          },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: "#f0f2f6" },
          title: {
            display: true,
            text: props.metric === "amount" ? t("百万 ₫") : t("订单数"),
            align: "end",
            color: "#8a93a2",
            font: { size: 11 },
          },
          ticks: {
            color: "#8a93a2",
            precision: props.metric === "count" ? 0 : undefined,
            font: { size: 11 },
          },
        },
      },
      onClick: (_, elements) => {
        if (
          elements[0] &&
          elements[0].datasetIndex === 0 &&
          props.rows[elements[0].index].orderCount !== null
        )
          emit("drill", props.rows[elements[0].index].date);
      },
    },
  });
}
onMounted(render);
watch(
  () => [props.rows, props.previous, props.metric, locale.value],
  async () => {
    await nextTick();
    render();
  },
  { deep: true },
);
onBeforeUnmount(() => chart?.destroy());
</script>
<template>
  <div class="p-chart">
    <canvas
      ref="canvas"
      role="img"
      :aria-label="
        metric === 'amount' ? '已完成订单额与上期比较' : '下单数与上期比较'
      "
    />
    <p class="sr-only">
      {{ $pt("图表数据见下方明细表。当前周期") }}{{ rows.length
      }}{{ $pt("天。") }}
    </p>
  </div>
</template>
