<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getPlatformMerchantDetail } from '@/api/platform';
import { useI18n } from '@/i18n';
import type { PlatformMerchantDetailResponse } from '@/types/api';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const detail = ref<PlatformMerchantDetailResponse>();
const loading = ref(false);
const message = ref('');

const merchantId = computed(() => String(route.params.id ?? ''));
const trendMaxOrderCount = computed(() =>
  Math.max(1, ...(detail.value?.trend.map((item) => item.orderCount) ?? [0])),
);
const trendMaxOrderAmount = computed(() =>
  Math.max(1, ...(detail.value?.trend.map((item) => Number(item.orderAmount)) ?? [0])),
);

const homepageCategoryLabelMap: Record<string, string> = {
  popular_food: '热门美食',
  chinese_dining: '中式正餐',
  noodles_snacks: '粉面小吃',
  coffee_milk_tea: '咖啡奶茶',
  flowers_gifts: '鲜花礼品',
  fresh_fruit: '水果生鲜',
  convenience_store: '便利超市',
  vietnamese_food: '特色越餐',
};

const riskItems = computed(() => {
  if (!detail.value) return [];
  const items: Array<{ label: string; value: string; tone: 'warning' | 'muted' | 'success' }> = [];
  if (detail.value.metrics.pendingAcceptanceOrderCount > 0) {
    items.push({
      label: '待接单订单',
      value: `${detail.value.metrics.pendingAcceptanceOrderCount} 单`,
      tone: 'warning',
    });
  }
  if (detail.value.merchant.profileCompletion < 100) {
    items.push({
      label: '资料完整度',
      value: `${detail.value.merchant.profileCompletion}%`,
      tone: 'warning',
    });
  }
  if (!detail.value.merchant.homepageCategoryKeys.length) {
    items.push({
      label: '首页分类',
      value: '未设置',
      tone: 'muted',
    });
  }
  if (items.length === 0) {
    items.push({
      label: '运营状态',
      value: '暂无提醒',
      tone: 'success',
    });
  }
  return items;
});

onMounted(loadDetail);

async function loadDetail() {
  loading.value = true;
  message.value = '';
  try {
    detail.value = await getPlatformMerchantDetail(merchantId.value);
  } catch (error) {
    message.value = errorMessage(error);
    detail.value = undefined;
  } finally {
    loading.value = false;
  }
}

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return `${amount.toLocaleString('en-US')} ₫`;
}

function dateTime(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '-';
}

function orderTypeLabel(value: string) {
  return (
    {
      DINE_IN: '堂食',
      PICKUP: '自取',
      DELIVERY: '配送',
    }[value] ?? value
  );
}

function statusLabel(value: string) {
  return (
    {
      PENDING_ACCEPTANCE: '待接单',
      ACCEPTED: '已接单',
      PREPARING: '制作中',
      READY: '待取餐',
      DELIVERING: '配送中',
      COMPLETED: '已完成',
      CANCELLED: '已取消',
      PENDING: '待审核',
      ACTIVE: '营业中',
      DISABLED: '已停用',
      DELETED: '已删除',
    }[value] ?? value
  );
}

function statusClass(value: string) {
  if (value === 'COMPLETED' || value === 'ACTIVE') return 'done';
  if (value === 'CANCELLED' || value === 'DISABLED' || value === 'DELETED') return 'cancelled';
  if (value === 'PREPARING' || value === 'READY' || value === 'DELIVERING') return 'working';
  if (value === 'PENDING_ACCEPTANCE' || value === 'PENDING') return 'pending';
  return 'working';
}

function reportFeatureLabel(value: boolean) {
  return value ? '营业日报已开放' : '营业日报未开放';
}

function categoryLabels(keys: string[]) {
  return keys.map((key) => homepageCategoryLabelMap[key] ?? key);
}

function shortDate(value: string) {
  return value.slice(5).replace('-', '/');
}

function trendOrderHeight(count: number) {
  return `${Math.max(8, Math.round((count / trendMaxOrderCount.value) * 100))}%`;
}

function trendAmountHeight(amount: string) {
  return `${Math.max(8, Math.round((Number(amount) / trendMaxOrderAmount.value) * 100))}%`;
}

function openEdit() {
  router.push(`/platform/merchants?edit=${merchantId.value}`);
}

function backToList() {
  router.push('/platform/merchants');
}
</script>

<template>
  <PageHeader
    :title="detail ? detail.merchant.name : '商家详情'"
    description="查看单个商家的基础信息、经营数据、运营配置和最近订单"
  >
    <div class="platform-detail-actions">
      <button class="secondary" type="button" @click="backToList">返回商家列表</button>
      <button class="platform-primary-action" type="button" :disabled="!detail" @click="openEdit">
        编辑商家
      </button>
    </div>
  </PageHeader>

  <p v-if="message" class="message">{{ message }}</p>

  <template v-if="loading">
    <section class="card empty">商家详情加载中...</section>
  </template>

  <template v-else-if="detail">
    <section
      class="card merchant-detail-hero"
      :class="{ 'has-cover': Boolean(detail.merchant.coverUrl) }"
      :style="
        detail.merchant.coverUrl
          ? {
              backgroundImage: `linear-gradient(135deg, rgba(20,109,43,.88), rgba(91,174,99,.72)), url(${detail.merchant.coverUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }
          : undefined
      "
    >
      <div class="merchant-detail-hero-top">
        <div class="merchant-detail-avatar">
          <img v-if="detail.merchant.logoUrl" :src="detail.merchant.logoUrl" :alt="detail.merchant.name" />
          <span v-else>{{ detail.merchant.name.slice(0, 1) }}</span>
        </div>
        <div class="merchant-detail-main">
        <div class="merchant-detail-title-row">
          <h2>{{ detail.merchant.name }}</h2>
          <span class="status-pill" :class="detail.merchant.isActive ? 'is-active' : 'is-disabled'">
            {{ statusLabel(detail.merchant.status) }}
          </span>
          <span class="status-pill" :class="detail.merchant.isVisibleOnClient ? 'is-active' : 'is-muted'">
            {{ detail.merchant.isVisibleOnClient ? t('clientVisibilityEnabled') : t('clientVisibilityDisabled') }}
          </span>
          <span class="status-pill" :class="detail.merchant.reportFeatureEnabled ? 'is-active' : 'is-muted'">
            {{ reportFeatureLabel(detail.merchant.reportFeatureEnabled) }}
          </span>
          <span class="popular-pill" :class="{ active: detail.merchant.manualPopular }">
            {{ detail.merchant.manualPopular ? '已推荐' : '未推荐' }}
          </span>
          </div>
          <p>
            账号：{{ detail.merchant.account }} · 手机号：{{ detail.merchant.phone }} · 资料完整度
            {{ detail.merchant.profileCompletion }}%
          </p>
          <p>
            城市 / 区域：{{ detail.merchant.city }}{{ detail.merchant.district ? ` / ${detail.merchant.district}` : '' }}
          </p>
        </div>
      </div>

      <div class="merchant-detail-tags">
        <span
          v-for="label in categoryLabels(detail.merchant.homepageCategoryKeys)"
          :key="label"
          class="category-tag"
        >
          {{ label }}
        </span>
        <span v-if="!detail.merchant.homepageCategoryKeys.length" class="muted-text">未设置首页分类</span>
      </div>

      <div class="merchant-detail-progress">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${detail.merchant.profileCompletion}%` }" />
        </div>
        <small>
          创建于 {{ dateTime(detail.merchant.createdAt) }} · 更新于 {{ dateTime(detail.merchant.updatedAt) }}
        </small>
      </div>
    </section>

    <section class="platform-merchant-detail-grid">
      <div class="card">
        <h2>基础信息</h2>
        <dl class="detail-list">
          <dt>商家 ID</dt>
          <dd>{{ detail.merchant.id }}</dd>
          <dt>营业状态</dt>
          <dd>{{ statusLabel(detail.merchant.status) }}</dd>
          <dt>{{ t('clientVisibility') }}</dt>
          <dd>{{ detail.merchant.isVisibleOnClient ? t('clientVisibilityEnabled') : t('clientVisibilityDisabled') }}</dd>
          <dt>营业日报</dt>
          <dd>{{ detail.merchant.reportFeatureEnabled ? '已开放' : '未开放' }}</dd>
          <dt>联系方式</dt>
          <dd>{{ detail.merchant.phone }}</dd>
          <dt>城市 / 区域</dt>
          <dd>{{ detail.merchant.city }}{{ detail.merchant.district ? ` / ${detail.merchant.district}` : '' }}</dd>
          <dt>详细地址</dt>
          <dd>{{ detail.merchant.address || '-' }}</dd>
          <dt>首页分类</dt>
          <dd>{{ categoryLabels(detail.merchant.homepageCategoryKeys).join('、') || '未设置' }}</dd>
          <dt>热门推荐</dt>
          <dd>{{ detail.merchant.manualPopular ? '已推荐' : '未推荐' }}</dd>
        </dl>
      </div>

      <div class="card">
        <h2>经营数据</h2>
        <div class="merchant-detail-stats">
          <div>
            <span>今日订单</span>
            <strong>{{ detail.metrics.todayOrderCount }} 单</strong>
          </div>
          <div>
            <span>今日订单金额</span>
            <strong>{{ money(detail.metrics.todayOrderAmount) }}</strong>
          </div>
          <div>
            <span>近 7 日订单</span>
            <strong>{{ detail.metrics.last7DaysOrderCount }} 单</strong>
          </div>
          <div>
            <span>近 7 日订单金额</span>
            <strong>{{ money(detail.metrics.last7DaysOrderAmount) }}</strong>
          </div>
          <div>
            <span>待接单</span>
            <strong>{{ detail.metrics.pendingAcceptanceOrderCount }} 单</strong>
          </div>
          <div>
            <span>制作中</span>
            <strong>{{ detail.metrics.preparingOrderCount }} 单</strong>
          </div>
          <div>
            <span>完成率</span>
            <strong>{{ detail.metrics.completionRate === null ? '-' : `${detail.metrics.completionRate}%` }}</strong>
          </div>
          <div>
            <span>平均订单金额</span>
            <strong>{{ detail.metrics.averageOrderAmount ? money(detail.metrics.averageOrderAmount) : '-' }}</strong>
          </div>
          <div>
            <span>已完成订单</span>
            <strong>{{ detail.metrics.completedOrderCount }} 单</strong>
          </div>
          <div>
            <span>已取消订单</span>
            <strong>{{ detail.metrics.canceledOrderCount }} 单</strong>
          </div>
        </div>
        <p class="hint">最近下单时间：{{ dateTime(detail.metrics.lastOrderAt) }}</p>
      </div>
    </section>

    <section class="card merchant-detail-trend-card">
      <div class="section-heading">
        <div>
          <h2>近 7 日订单趋势</h2>
          <p>按越南时间统计近 7 天非取消订单</p>
        </div>
      </div>
      <div v-if="detail.trend.length" class="merchant-trend-grid">
        <div v-for="item in detail.trend" :key="item.date" class="merchant-trend-item">
          <div class="merchant-trend-track">
            <span class="merchant-trend-fill count" :style="{ height: trendOrderHeight(item.orderCount) }" />
            <span class="merchant-trend-fill amount" :style="{ height: trendAmountHeight(item.orderAmount) }" />
          </div>
          <strong>{{ shortDate(item.date) }}</strong>
          <small>{{ item.orderCount }} 单 · {{ money(item.orderAmount) }}</small>
        </div>
      </div>
      <p v-else class="empty">暂无近 7 日趋势数据</p>
    </section>

    <section class="card merchant-risk-card">
      <div class="section-heading">
        <h2>风险提醒</h2>
        <span class="badge muted">基于当前数据</span>
      </div>
      <div class="merchant-risk-list">
        <div
          v-for="item in riskItems"
          :key="item.label"
          class="merchant-risk-item"
          :class="`is-${item.tone}`"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
    </section>

    <section class="platform-merchant-detail-grid">
      <div class="card">
        <h2>运营配置</h2>
        <div class="merchant-detail-stats merchant-operation-stats">
          <div>
            <span>分类数量</span>
            <strong>{{ detail.operation.menuCategoryCount }}</strong>
          </div>
          <div>
            <span>菜品数量</span>
            <strong>{{ detail.operation.dishCount }}</strong>
          </div>
          <div>
            <span>在售菜品</span>
            <strong>{{ detail.operation.activeDishCount }}</strong>
          </div>
          <div>
            <span>桌台数量</span>
            <strong>{{ detail.operation.tableCount }}</strong>
          </div>
          <div>
            <span>启用桌台</span>
            <strong>{{ detail.operation.activeTableCount }}</strong>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>近期订单摘要</h2>
        <p class="hint">仅展示最近 5 笔订单，便于核对平台订单统计。</p>
        <div class="table-wrap">
          <table class="platform-merchant-recent-orders">
            <thead>
              <tr>
                <th>订单号</th>
                <th>类型</th>
                <th>状态</th>
                <th>金额</th>
                <th>联系电话</th>
                <th>下单时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in detail.recentOrders" :key="order.id">
                <td class="order-no-cell">{{ order.orderNo }}</td>
                <td><span class="order-type-pill">{{ orderTypeLabel(order.orderType) }}</span></td>
                <td>
                  <span class="order-status-pill" :class="statusClass(order.status)">
                    {{ statusLabel(order.status) }}
                  </span>
                </td>
                <td>{{ money(order.totalAmount) }}</td>
                <td>{{ order.contactPhone || '-' }}</td>
                <td>{{ dateTime(order.createdAt) }}</td>
              </tr>
              <tr v-if="detail.recentOrders.length === 0">
                <td colspan="6" class="empty">暂无最近订单</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </template>
</template>
