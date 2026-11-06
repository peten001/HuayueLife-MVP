<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import PlatformTrendChart from "./PlatformTrendChart.vue";
import { usePlatformLocale } from "@/composables/usePlatformLocale";
import { exploreRequest, getPlatformAnalytics } from "@/api/platform";
import { errorMessage } from "@/api/http";
import {
  platformMoney as money,
  vietnamDate,
  vietnamTime,
} from "@/utils/platform-format";
import type { PlatformAnalyticsResponse } from "@/types/api";
const props = defineProps<{ overview?: boolean }>();
const router = useRouter();
const { t } = usePlatformLocale();
const dateOffset = (days: number) =>
  vietnamDate(new Date(Date.now() + days * 86400000));
const filters = reactive({
  dateFrom: dateOffset(props.overview ? 0 : -6),
  dateTo: dateOffset(0),
  city: "",
  merchantId: "",
});
const applied = ref({ ...filters });
const data = ref<PlatformAnalyticsResponse>();
const loading = ref(false);
const error = ref("");
const updated = ref("");
const advanced = ref(false);
const metric = ref<"amount" | "count">("amount");
const queue = ref<Array<{ label: string; count: number; path: string }>>([]);
let sequence = 0;
const summary = computed(() => data.value?.summary);
const rank = computed(() =>
  metric.value === "amount"
    ? data.value?.merchantRankingByAmount
    : data.value?.merchantRankingByOrders,
);
const maxCity = computed(() =>
  Math.max(
    1,
    ...(data.value?.cityStats.map((row) => Number(row.orderAmount)) || []),
  ),
);
const delta = computed(() => {
  if (!data.value?.previous) return "—";
  const before =
    metric.value === "amount"
      ? Number(data.value.previous.orderAmount)
      : data.value.previous.orderCount;
  const current =
    metric.value === "amount"
      ? Number(data.value.summary.orderAmount)
      : data.value.summary.orderCount;
  return before === 0
    ? current === 0
      ? "0%"
      : "上期为 0"
    : `${current >= before ? "+" : ""}${(((current - before) / before) * 100).toFixed(1)}%`;
});
async function load() {
  const id = ++sequence;
  loading.value = true;
  error.value = "";
  const requested = { ...filters };
  try {
    const response = await getPlatformAnalytics(requested);
    if (id !== sequence) return;
    data.value = response;
    applied.value = requested;
    updated.value = new Date().toISOString();
  } catch (e) {
    if (id === sequence) error.value = errorMessage(e);
  } finally {
    if (id === sequence) loading.value = false;
  }
}
async function period(days: number) {
  filters.dateFrom = dateOffset(1 - days);
  filters.dateTo = dateOffset(0);
  await load();
}
function drill(date?: string, merchantId?: string, city?: string) {
  router.push({
    path: "/platform/orders",
    query: {
      dateFrom: date?.slice(0, 10) || applied.value.dateFrom,
      dateTo: date?.slice(0, 10) || applied.value.dateTo,
      city: city || applied.value.city,
      ...(date?.includes("T") ? { hour: date.slice(11, 13) } : {}),
      merchantId: merchantId || applied.value.merchantId,
      ...(metric.value === "amount" ? { status: "COMPLETED" } : {}),
    },
  });
}
function exportCsv() {
  if (!data.value) return;
  const rows = [
    ["日期", "下单数（含取消）", "已完成订单额（₫）"],
    ...data.value.trend.map((row) => [
      row.date,
      String(row.orderCount),
      row.orderAmount,
    ]),
  ];
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `YunQiao-${applied.value.dateFrom}-${applied.value.dateTo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
onMounted(() => {
  void load();
  if (props.overview)
    exploreRequest<{ items: typeof queue.value }>(
      "get",
      "/platform/workbench/queue",
    )
      .then((d) => (queue.value = d.items))
      .catch(() => {});
});
</script>
<template>
  <section>
    <PageHeader
      :title="t(overview ? '运营总览' : '营业分析')"
      :description="
        overview
          ? '从今天的经营变化，找到接下来需要处理的事。'
          : '按城市与商家追踪订单表现，比较前一周期。'
      "
      ><div class="p-inline">
        <button class="secondary" :disabled="!data" @click="exportCsv">
          {{ $pt("导出数据") }}</button
        ><button :disabled="loading" @click="load">
          {{ loading ? $pt("正在更新…") : t($pt("刷新")) }}
        </button>
      </div></PageHeader
    >
    <div class="p-inline" style="margin-bottom: 24px">
      <div class="p-period-buttons">
        <button
          v-for="p in [
            { days: 1, label: '今天' },
            { days: 7, label: '近 7 天' },
            { days: 30, label: '近 30 天' },
          ]"
          :key="p.days"
          :aria-pressed="
            applied.dateFrom === dateOffset(1 - p.days) &&
            applied.dateTo === dateOffset(0)
          "
          class="secondary small"
          @click="period(p.days)"
        >
          {{ t(p.label) }}
        </button>
      </div>
      <span class="p-muted">{{ applied.dateFrom }} — {{ applied.dateTo }}</span
      ><button class="text-button" @click="advanced = !advanced">
        {{ t($pt("高级筛选")) }} {{ advanced ? "−" : "＋" }}
      </button>
    </div>
    <form v-if="advanced" class="card p-inline" @submit.prevent="load">
      <label
        >{{ $pt("开始日期")
        }}<input v-model="filters.dateFrom" type="date" required /></label
      ><label
        >{{ $pt("结束日期")
        }}<input v-model="filters.dateTo" type="date" required /></label
      ><label
        >{{ $pt("城市")
        }}<input v-model="filters.city" :placeholder="$pt('全部城市')" /></label
      ><label
        >{{ $pt("商家编号")
        }}<input
          v-model="filters.merchantId"
          inputmode="numeric"
          pattern="[0-9]*"
          :placeholder="$pt('全部商家')" /></label
      ><button :disabled="loading">{{ t($pt("查询")) }}</button>
    </form>
    <p v-if="error" class="error" role="alert">
      {{ error }}{{ data ? $pt("。下方保留上次成功查询结果，请重试。") : "" }}
    </p>
    <p v-if="loading && !data" role="status" class="card">
      {{ $pt("正在读取经营数据…") }}
    </p>
    <template v-if="data && summary">
      <div class="platform-metric-grid">
        <button
          class="platform-metric-card highlight p-metric-link"
          @click="
            metric = 'amount';
            drill();
          "
        >
          <span>{{ t($pt("已完成订单额")) }}</span
          ><strong>{{ money(summary.orderAmount) }}</strong
          ><small
            >{{ $pt("已完成") }}{{ summary.completedOrderCount
            }}{{ $pt("单 · 按订单记录") }}</small
          >
        </button>
        <button
          class="platform-metric-card p-metric-link"
          @click="
            metric = 'count';
            drill();
          "
        >
          <span>{{ t($pt("下单数")) }}</span
          ><strong>{{ summary.orderCount.toLocaleString() }}</strong
          ><small>{{ $pt("包含取消订单，排除作废单") }}</small>
        </button>
        <article class="platform-metric-card">
          <span>{{ t($pt("进行中订单额")) }}</span
          ><strong>{{ money(summary.activeOrderAmount) }}</strong
          ><small>{{ summary.pendingOrderCount }}{{ $pt("单进行中") }}</small>
        </article>
        <article class="platform-metric-card">
          <span>{{ t($pt("取消订单")) }}</span
          ><strong>{{ summary.canceledOrderCount.toLocaleString() }}</strong
          ><small
            >{{ money(summary.canceledOrderAmount) }}{{ $pt("· 取消率")
            }}{{ summary.cancelRate ?? "—"
            }}{{ summary.cancelRate === null ? "" : "%" }}</small
          >
        </article>
      </div>
      <div class="p-split">
        <article class="card">
          <div class="section-heading">
            <div>
              <h2>
                {{
                  metric === "amount"
                    ? t($pt("已完成订单额"))
                    : t($pt("下单数"))
                }}{{ $pt("趋势") }}
              </h2>
              <small
                >{{ data.previous?.dateFrom }} — {{ data.previous?.dateTo
                }}{{ $pt("· 同长度周期比较") }}{{ delta }}</small
              >
            </div>
            <div class="p-inline">
              <button
                class="secondary small"
                :aria-pressed="metric === 'amount'"
                @click="metric = 'amount'"
              >
                {{ $pt("订单额") }}</button
              ><button
                class="secondary small"
                :aria-pressed="metric === 'count'"
                @click="metric = 'count'"
              >
                {{ $pt("下单数") }}
              </button>
            </div>
          </div>
          <PlatformTrendChart
            :rows="data.chartTrend || data.trend"
            :previous="data.previous?.chartTrend || data.previous?.trend"
            :metric="metric"
            @drill="drill"
          />
          <p class="p-summary-note">
            {{ $pt("点击本期节点查看当天明细。")
            }}{{ data.range?.includesToday ? $pt("今天的数据仍在更新。") : ""
            }}{{ $pt("时区 UTC+7 ·") }}{{ updated ? vietnamTime(updated) : "" }}
          </p>
        </article>
        <article v-if="overview" class="card">
          <div class="section-heading">
            <h2>{{ t($pt("待处理事项")) }}</h2>
            <span class="badge">{{ $pt("实时") }}</span>
          </div>
          <RouterLink
            v-for="item in queue"
            :key="item.path"
            class="p-queue-link"
            :to="item.path"
            ><span>{{ t(item.label) }}</span
            ><strong>{{ item.count }}</strong
            ><span aria-hidden="true">→</span></RouterLink
          >
          <p v-if="!queue.length" class="hint">
            {{ $pt("待办数据尚未读取成功，可从右上角待办入口重试。") }}
          </p>
          <div class="p-quick-links">
            <RouterLink to="/platform/merchants/new">{{
              $pt("新增商家 →")
            }}</RouterLink
            ><RouterLink to="/platform/recommendations">{{
              $pt("内容运营 →")
            }}</RouterLink>
          </div>
        </article>
        <article v-else class="card">
          <h2>{{ $pt("城市表现") }}</h2>
          <button
            v-for="row in data.cityStats.slice(0, 6)"
            :key="row.city"
            class="p-city-bar"
            @click="drill(undefined, undefined, row.city)"
          >
            <span
              >{{ row.city }}<strong>{{ money(row.orderAmount) }}</strong></span
            ><i
              ><b
                :style="{
                  width: `${(Number(row.orderAmount) / maxCity) * 100}%`,
                }" /></i
            ><small
              >{{ row.orderCount }}{{ $pt("单 ·") }}{{ row.merchantCount
              }}{{ $pt("家商家") }}</small
            >
          </button>
          <p v-if="!data.cityStats.length" class="empty-state">
            {{ $pt("当前范围暂无订单") }}
          </p>
        </article>
      </div>
      <div class="p-split">
        <article class="card">
          <div class="section-heading">
            <h2>{{ $pt("商家表现") }}</h2>
            <small
              >{{ metric === "amount" ? $pt("按已完成订单额") : $pt("按下单数")
              }}{{ $pt("排序") }}</small
            >
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ $pt("商家") }}</th>
                  <th>{{ $pt("城市") }}</th>
                  <th>{{ $pt("下单数") }}</th>
                  <th>{{ $pt("已完成订单额") }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in rank" :key="row.merchantId">
                  <td>
                    <span class="p-rank">{{ index + 1 }}</span
                    >{{ row.merchantName }}
                  </td>
                  <td>{{ row.city }}</td>
                  <td>{{ row.orderCount }}</td>
                  <td>{{ money(row.orderAmount) }}</td>
                  <td>
                    <button
                      class="p-table-action"
                      @click="drill(undefined, row.merchantId)"
                    >
                      {{ $pt("查看明细") }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!rank?.length" class="empty-state">
            {{ $pt("当前范围暂无订单") }}
          </p>
        </article>
        <article class="card">
          <h2>{{ $pt("服务类型分布") }}</h2>
          <div
            v-for="(row, index) in data.orderTypeDistribution"
            :key="row.type"
            class="p-distribution"
          >
            <div>
              <i
                :style="{
                  background: ['#416bd8', '#7961c8', '#288f95'][index],
                }"
              /><span>{{
                row.type === "DINE_IN"
                  ? $pt("堂食")
                  : row.type === "PICKUP"
                    ? $pt("自取")
                    : $pt("配送")
              }}</span
              ><strong>{{ row.count }}{{ $pt("单") }}</strong>
            </div>
            <p>
              {{ money(row.amount) }} <small>{{ $pt("已完成订单额") }}</small>
            </p>
            <div class="p-distribution-track">
              <i
                :style="{
                  width: `${summary.orderCount ? (row.count / summary.orderCount) * 100 : 0}%`,
                  background: ['#416bd8', '#7961c8', '#288f95'][index],
                }"
              />
            </div>
          </div>
        </article>
      </div>
      <details class="card">
        <summary>{{ $pt("查看逐日数据与统计口径") }}</summary>
        <p class="hint">
          {{
            $pt(
              "下单数含取消单，统计统一排除作废单。主要金额只累计已完成订单，按下单日期归属；进行中与取消金额另列，不代表实收或结算收入。",
            )
          }}
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ $pt("日期") }}</th>
                <th>{{ $pt("下单数") }}</th>
                <th>{{ $pt("已完成订单额") }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.trend" :key="row.date">
                <td>{{ row.date }}</td>
                <td>{{ row.orderCount }}</td>
                <td>{{ money(row.orderAmount) }}</td>
                <td>
                  <button class="p-table-action" @click="drill(row.date)">
                    {{ $pt("明细") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>
  </section>
</template>
