<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import PlatformDrawer from "@/components/platform/PlatformDrawer.vue";
import { platformMoney } from "@/utils/platform-format";
import PageHeader from "@/components/PageHeader.vue";
import { errorMessage } from "@/api/http";
import { getPlatformOrders } from "@/api/platform";
import type {
  OrderStatus,
  OrderType,
  PlatformOrderFilters,
  PlatformOrderListItem,
  PlatformOrdersResponse,
} from "@/types/api";

const response = ref<PlatformOrdersResponse | null>(null);
const selectedOrder = ref<PlatformOrderListItem | null>(null);
const loading = ref(false);
const message = ref("");
const route = useRoute();
const filters = reactive<
  Required<Pick<PlatformOrderFilters, "page" | "pageSize">> &
    Omit<PlatformOrderFilters, "page" | "pageSize">
>({
  page: 1,
  pageSize: 20,
  dateFrom: "",
  dateTo: "",
  merchantKeyword: "",
  merchantId: "",
  city: "",
  orderType: "",
  status: "",
  phone: "",
  orderNo: "",
});

const applied = ref({ ...filters });
const advanced = ref(false);
let requestSequence = 0;
const totalPages = computed(() =>
  Math.max(1, Math.ceil((response.value?.total ?? 0) / filters.pageSize)),
);
const rows = computed(() => response.value?.items ?? []);
const summary = computed(() => response.value?.summary);
const activeFilterLabels = computed(() => {
  const labels: string[] = [];
  const merchantKeyword = applied.value.merchantKeyword?.trim() ?? "";
  const city = applied.value.city?.trim() ?? "";
  const phone = applied.value.phone?.trim() ?? "";
  const orderNo = applied.value.orderNo?.trim() ?? "";
  if (applied.value.dateFrom || applied.value.dateTo)
    labels.push(
      `日期：${applied.value.dateFrom || "不限"} 至 ${applied.value.dateTo || "不限"}`,
    );
  if (merchantKeyword) labels.push(`商家：${merchantKeyword}`);
  if (city) labels.push(`城市：${city}`);
  if (applied.value.orderType)
    labels.push(`类型：${orderTypeLabel(applied.value.orderType)}`);
  if (applied.value.status)
    labels.push(`状态：${orderStatusLabel(applied.value.status)}`);
  if (phone) labels.push(`手机号：${phone}`);
  if (orderNo) labels.push(`订单号：${orderNo}`);
  if (applied.value.hour !== undefined)
    labels.push(
      `时段：${applied.value.hour}:00–${Number(applied.value.hour) + 1}:00`,
    );
  if (applied.value.merchantId)
    labels.push(`商家编号：${applied.value.merchantId}`);
  return labels;
});

function readRoute() {
  if (!Object.keys(route.query).length) {
    try {
      Object.assign(
        filters,
        JSON.parse(sessionStorage.getItem("yunqiao.platform.orders") || "{}"),
      );
    } catch {}
    return;
  }
  Object.assign(filters, {
    page: 1,
    pageSize: 20,
    dateFrom: "",
    dateTo: "",
    merchantKeyword: "",
    merchantId: "",
    city: "",
    orderType: "",
    status: "",
    phone: "",
    orderNo: "",
    hour: undefined,
    pendingBefore: "",
  });
  for (const key of [
    "dateFrom",
    "dateTo",
    "city",
    "merchantId",
    "status",
    "orderType",
    "phone",
    "orderNo",
    "pendingBefore",
    "hour",
  ] as const) {
    const value = route.query[key];
    if (typeof value === "string")
      (filters as Record<string, unknown>)[key] = value;
  }
}
onMounted(() => {
  readRoute();
  void loadOrders();
});
watch(
  () => route.fullPath,
  () => {
    readRoute();
    void loadOrders();
  },
);
async function loadOrders() {
  const id = ++requestSequence;
  const query = { ...filters };
  loading.value = true;
  message.value = "";
  try {
    const data = await getPlatformOrders(query);
    if (id !== requestSequence) return;
    response.value = data;
    applied.value = query;
    sessionStorage.setItem("yunqiao.platform.orders", JSON.stringify(query));
  } catch (error) {
    if (id === requestSequence)
      message.value =
        errorMessage(error) +
        (response.value ? "。下方保留上次成功结果。" : "");
  } finally {
    if (id === requestSequence) loading.value = false;
  }
}

function search() {
  filters.page = 1;
  void loadOrders();
}

function resetFilters() {
  filters.page = 1;
  filters.dateFrom = "";
  filters.dateTo = "";
  filters.merchantKeyword = "";
  filters.merchantId = "";
  filters.pendingBefore = "";
  filters.hour = undefined;
  filters.city = "";
  filters.orderType = "";
  filters.status = "";
  filters.phone = "";
  filters.orderNo = "";
  void loadOrders();
}

function goPage(page: number) {
  filters.page = Math.min(Math.max(1, page), totalPages.value);
  void loadOrders();
}

function money(value: string | number) {
  return platformMoney(value);
}

function dateTime(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(value))
    : "-";
}

function orderTypeLabel(type: OrderType) {
  const labels: Record<OrderType, string> = {
    DINE_IN: "堂食",
    PICKUP: "自取",
    DELIVERY: "配送",
  };
  return labels[type] ?? type;
}

function orderStatusLabel(status: OrderStatus) {
  const labels: Record<OrderStatus, string> = {
    PENDING_ACCEPTANCE: "待接单",
    ACCEPTED: "已接单",
    PREPARING: "制作中",
    READY: "待取餐",
    DELIVERING: "配送中",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
  };
  return labels[status] ?? status;
}

function orderDetailText(order: PlatformOrderListItem) {
  if (order.orderType === "DINE_IN") {
    return order.tableNo || order.tableName
      ? `桌号：${order.tableNo || order.tableName}`
      : "-";
  }
  if (order.orderType === "PICKUP") {
    return order.pickupName || order.contactName
      ? `自取：${order.pickupName || order.contactName}`
      : "自取";
  }
  return order.deliveryAddress ? `配送：${order.deliveryAddress}` : "配送";
}

function region(order: PlatformOrderListItem) {
  return (
    [order.merchantCity, order.merchantDistrict].filter(Boolean).join(" / ") ||
    "-"
  );
}

function statusClass(status: OrderStatus) {
  if (status === "PENDING_ACCEPTANCE") return "pending";
  if (["ACCEPTED", "PREPARING", "READY", "DELIVERING"].includes(status))
    return "working";
  if (status === "COMPLETED") return "done";
  return "cancelled";
}

function completionText(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${value}%`;
}
</script>

<template>
  <PageHeader
    :title="$pt('订单管理')"
    :description="
      $pt('查看平台全部商户订单，支持按日期、商户、状态和订单类型筛选')
    "
  >
    <button class="secondary" :disabled="loading" @click="loadOrders">
      {{ loading ? $pt("刷新中...") : $pt("刷新") }}
    </button>
  </PageHeader>

  <p v-if="message" class="message">{{ $pt(message) }}</p>

  <section class="card platform-order-filters">
    <label v-if="advanced"
      >{{ $pt("日期开始") }}<input v-model="filters.dateFrom" type="date" />
    </label>
    <label v-if="advanced"
      >{{ $pt("日期结束") }}<input v-model="filters.dateTo" type="date" />
    </label>
    <label
      >{{ $pt("商家名称")
      }}<input
        v-model="filters.merchantKeyword"
        :placeholder="$pt('输入商家名称或手机号')"
      />
    </label>
    <label v-if="advanced"
      >{{ $pt("城市")
      }}<input v-model="filters.city" :placeholder="$pt('全部城市')" />
    </label>
    <label v-if="advanced"
      >{{ $pt("订单类型")
      }}<select v-model="filters.orderType">
        <option value="">{{ $pt("全部") }}</option>
        <option value="DINE_IN">{{ $pt("堂食") }}</option>
        <option value="PICKUP">{{ $pt("自取") }}</option>
        <option value="DELIVERY">{{ $pt("配送") }}</option>
      </select>
    </label>
    <label
      >{{ $pt("状态")
      }}<select v-model="filters.status">
        <option value="">{{ $pt("全部状态") }}</option>
        <option value="PENDING_ACCEPTANCE">{{ $pt("待接单") }}</option>
        <option value="ACCEPTED">{{ $pt("已接单") }}</option>
        <option value="PREPARING">{{ $pt("制作中") }}</option>
        <option value="READY">{{ $pt("待取餐") }}</option>
        <option value="DELIVERING">{{ $pt("配送中") }}</option>
        <option value="COMPLETED">{{ $pt("已完成") }}</option>
        <option value="CANCELLED">{{ $pt("已取消") }}</option>
      </select>
    </label>
    <label v-if="advanced"
      >{{ $pt("手机号")
      }}<input v-model="filters.phone" :placeholder="$pt('输入联系电话')" />
    </label>
    <label
      >{{ $pt("订单号")
      }}<input v-model="filters.orderNo" :placeholder="$pt('输入订单号')" />
    </label>
    <div class="platform-order-filter-actions">
      <button class="text-button" type="button" @click="advanced = !advanced">
        {{ $pt("高级筛选") }} {{ advanced ? "−" : "＋" }}
      </button>
      <button type="button" @click="search">{{ $pt("查询") }}</button>
      <button class="secondary" type="button" @click="resetFilters">
        {{ $pt("重置") }}
      </button>
    </div>
    <div class="platform-filter-state">
      <span v-if="activeFilterLabels.length === 0">{{
        $pt("当前筛选：全部订单")
      }}</span>
      <template v-else>
        <span
          v-for="label in activeFilterLabels"
          :key="label"
          class="category-tag"
        >
          {{ label }}
        </span>
      </template>
    </div>
  </section>

  <section class="card platform-order-card">
    <div class="platform-table-header">
      <div>
        <h2>{{ $pt("订单列表") }}</h2>
        <p>{{ $pt("共") }}{{ response?.total ?? 0 }}{{ $pt("条订单") }}</p>
      </div>
      <label class="page-size-control"
        >{{ $pt("每页")
        }}<select v-model.number="filters.pageSize" @change="search">
          <option :value="10">10</option>
          <option :value="20">20</option>
          <option :value="50">50</option>
        </select>
      </label>
    </div>

    <div class="table-wrap">
      <table class="platform-order-table">
        <thead>
          <tr>
            <th>{{ $pt("订单号") }}</th>
            <th>{{ $pt("商户") }}</th>
            <th>{{ $pt("订单类型") }}</th>
            <th>{{ $pt("详情") }}</th>
            <th>{{ $pt("订单金额") }}</th>
            <th>{{ $pt("状态") }}</th>
            <th>{{ $pt("下单时间") }}</th>
            <th>{{ $pt("联系电话") }}</th>
            <th>{{ $pt("操作") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rows" :key="item.id">
            <td class="order-no-cell">{{ item.orderNo }}</td>
            <td>
              <strong>{{ item.merchantName }}</strong>
              <small>{{ region(item) }}</small>
            </td>
            <td>
              <span class="order-type-pill">{{
                $pt(orderTypeLabel(item.orderType))
              }}</span>
            </td>
            <td class="order-detail-cell">{{ orderDetailText(item) }}</td>
            <td>{{ money(item.totalAmount) }}</td>
            <td>
              <span class="order-status-pill" :class="statusClass(item.status)">
                {{ $pt(orderStatusLabel(item.status))
                }}{{ item.voidedAt ? $pt(" · 已作废") : "" }}
              </span>
            </td>
            <td>{{ dateTime(item.createdAt) }}</td>
            <td>{{ item.contactPhone || "-" }}</td>
            <td>
              <button class="small secondary" @click="selectedOrder = item">
                {{ $pt("查看详情") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="loading" class="empty">{{ $pt("订单数据加载中...") }}</p>
      <p v-else-if="rows.length === 0" class="empty">
        {{ $pt("暂无符合条件的订单") }}
      </p>
    </div>

    <div class="platform-pagination">
      <button
        class="secondary small"
        :disabled="filters.page <= 1"
        @click="goPage(applied.page - 1)"
      >
        {{ $pt("上一页") }}
      </button>
      <span
        >{{ $pt("第") }}{{ applied.page }} / {{ totalPages
        }}{{ $pt("页") }}</span
      >
      <button
        class="secondary small"
        :disabled="filters.page >= totalPages"
        @click="goPage(applied.page + 1)"
      >
        {{ $pt("下一页") }}
      </button>
    </div>
  </section>

  <section class="platform-order-summary-grid">
    <article class="card platform-metric-card">
      <span>{{ $pt("今日订单总数") }}</span>
      <strong>{{ summary?.todayOrderCount ?? "—" }}</strong>
      <small>{{ $pt("含取消订单，排除作废单") }}</small>
    </article>
    <article class="card platform-metric-card">
      <span>{{ $pt("待处理订单") }}</span>
      <strong>{{ summary?.pendingOrderCount ?? "—" }}</strong>
      <small>{{ $pt("待接单、已接单、制作中、配送中") }}</small>
    </article>
    <article class="card platform-metric-card">
      <span>{{ $pt("完成率") }}</span>
      <strong>{{ completionText(summary?.completedRate) }}</strong>
      <small>{{ $pt("今日已完成 / 今日非取消订单") }}</small>
    </article>
    <article class="card platform-metric-card highlight">
      <span>{{ $pt("今日已完成订单额") }}</span>
      <strong>{{ money(summary?.todayOrderAmount ?? "") }}</strong>
      <small>{{ $pt("按订单总额统计，未接支付") }}</small>
    </article>
  </section>

  <PlatformDrawer
    :open="!!selectedOrder"
    :title="$pt('订单详情')"
    wide
    @close="selectedOrder = null"
  >
    <section v-if="selectedOrder" class="platform-order-detail">
      <div class="section-heading">
        <div>
          <h2>{{ $pt("订单详情") }}</h2>
          <p>{{ selectedOrder.orderNo }} · {{ selectedOrder.merchantName }}</p>
        </div>
        <button class="secondary small" @click="selectedOrder = null">
          {{ $pt("关闭") }}
        </button>
      </div>
      <dl class="detail-list">
        <dt>{{ $pt("订单号") }}</dt>
        <dd>{{ selectedOrder.orderNo }}</dd>
        <dt>{{ $pt("商家名称") }}</dt>
        <dd>{{ selectedOrder.merchantName }}</dd>
        <dt>{{ $pt("订单类型") }}</dt>
        <dd>{{ $pt(orderTypeLabel(selectedOrder.orderType)) }}</dd>
        <dt>{{ $pt("订单状态") }}</dt>
        <dd>
          {{ $pt(orderStatusLabel(selectedOrder.status))
          }}{{ selectedOrder.voidedAt ? $pt(" · 已作废") : "" }}
        </dd>
        <dt>{{ $pt("下单时间") }}</dt>
        <dd>{{ dateTime(selectedOrder.createdAt) }}</dd>
        <dt>{{ $pt("订单金额") }}</dt>
        <dd>{{ money(selectedOrder.totalAmount) }}</dd>
        <dt>{{ $pt("联系人") }}</dt>
        <dd>{{ selectedOrder.contactName || "-" }}</dd>
        <dt>{{ $pt("联系电话") }}</dt>
        <dd>{{ selectedOrder.contactPhone || "-" }}</dd>
        <dt>{{ $pt("服务信息") }}</dt>
        <dd>{{ orderDetailText(selectedOrder) }}</dd>
        <dt>{{ $pt("备注") }}</dt>
        <dd>{{ selectedOrder.customerRemark || "-" }}</dd>
        <dt>{{ $pt("接单时间") }}</dt>
        <dd>{{ dateTime(selectedOrder.acceptedAt) }}</dd>
        <dt>{{ $pt("完成时间") }}</dt>
        <dd>{{ dateTime(selectedOrder.completedAt) }}</dd>
        <dt>{{ $pt("取消时间") }}</dt>
        <dd>{{ dateTime(selectedOrder.canceledAt) }}</dd>
      </dl>

      <h3>{{ $pt("订单商品") }}</h3>
      <table class="platform-order-items-table">
        <thead>
          <tr>
            <th>{{ $pt("商品") }}</th>
            <th>{{ $pt("单价") }}</th>
            <th>{{ $pt("数量") }}</th>
            <th>{{ $pt("小计") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in selectedOrder.items" :key="item.id">
            <td>
              {{ item.productNameZhSnapshot }}
              <small v-if="item.remark">{{ item.remark }}</small>
            </td>
            <td>{{ money(item.unitPriceVnd) }}</td>
            <td>{{ item.quantity }}</td>
            <td>{{ money(item.subtotalVnd) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ $pt("状态时间信息") }}</h3>
      <ul class="platform-order-log">
        <li v-for="log in selectedOrder.statusLogs" :key="log.id">
          <strong>{{ $pt(orderStatusLabel(log.toStatus)) }}</strong>
          <span>{{ dateTime(log.createdAt) }}</span>
          <small>{{ log.remark || log.operatorType }}</small>
        </li>
      </ul>
    </section>
  </PlatformDrawer>
</template>
