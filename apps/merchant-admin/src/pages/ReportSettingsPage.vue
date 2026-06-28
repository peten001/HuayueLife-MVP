<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  getReportFeature,
  getReportSettings,
  previewDailyReport,
  sendDailyReportMock,
  updateReportSettings,
} from '@/api/reports';
import type { DailyReportLanguage, DailyReportPreviewResponse, MerchantReportSettings } from '@/types/api';

const router = useRouter();
const loading = ref(true);
const saving = ref(false);
const previewing = ref(false);
const sending = ref(false);
const featureEnabled = ref(false);
const message = ref('');
const sendMessage = ref('');
const preview = ref<DailyReportPreviewResponse | null>(null);
const form = reactive<MerchantReportSettings>({
  enabled: false,
  zaloRecipient: '',
  pushTime: '22:00',
  language: 'zh',
  aiSuggestions: false,
});

const reportImageSrc = computed(() =>
  preview.value?.imageUrl ? resolveReportImageUrl(preview.value.imageUrl) : '',
);
const statusEntries = computed(() =>
  Object.entries(preview.value?.summary.statusCounts ?? {}).filter(([, count]) => count > 0),
);
const topProducts = computed(() => preview.value?.summary.topProducts ?? []);
const suggestions = computed(() => preview.value?.summary.suggestions ?? []);

onMounted(loadPage);

async function loadPage() {
  loading.value = true;
  message.value = '';
  try {
    const feature = await getReportFeature();
    featureEnabled.value = feature.enabled;
    if (!feature.enabled) {
      return;
    }
    const settings = await getReportSettings();
    Object.assign(form, settings);
    await loadPreview(settings.language);
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  if (!featureEnabled.value) return;
  saving.value = true;
  message.value = '';
  try {
    const payload: MerchantReportSettings = {
      enabled: form.enabled,
      zaloRecipient: form.zaloRecipient.trim(),
      pushTime: form.pushTime,
      language: form.language,
      aiSuggestions: form.aiSuggestions,
    };
    const settings = await updateReportSettings(payload);
    Object.assign(form, settings);
    message.value = '日报设置已保存';
    await loadPreview(settings.language);
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

async function loadPreview(language: DailyReportLanguage = form.language) {
  if (!featureEnabled.value) return;
  previewing.value = true;
  message.value = '';
  try {
    preview.value = await previewDailyReport(language);
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    previewing.value = false;
  }
}

async function sendMockReport() {
  if (!featureEnabled.value) return;
  sending.value = true;
  sendMessage.value = '';
  try {
    const result = await sendDailyReportMock(form.language);
    sendMessage.value = `${result.message} · mock sent`;
    await loadPreview(form.language);
  } catch (error) {
    sendMessage.value = errorMessage(error);
  } finally {
    sending.value = false;
  }
}

function money(value: string) {
  const amount = Number(value ?? 0);
  return `${amount.toLocaleString('zh-CN')} ₫`;
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
    }[value] ?? value
  );
}

function resolveReportImageUrl(imageUrl: string) {
  const apiBase =
    import.meta.env.VITE_API_BASE_URL ??
    (import.meta.env.PROD
      ? 'https://api.huayueyouxuan.com/api/v1'
      : 'http://localhost:3001/api/v1');
  const origin = apiBase.replace(/\/api\/v1\/?$/, '');
  if (/^(https?:)?\/\//i.test(imageUrl)) {
    return imageUrl;
  }
  return `${origin}${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`;
}
</script>

<template>
  <PageHeader
    title="营业日报"
    description="当前阶段支持日报预览和测试发送，自动定时推送将在下一阶段开启。"
  />

  <p v-if="message" class="message">{{ message }}</p>
  <p v-if="sendMessage" class="message success">{{ sendMessage }}</p>

  <template v-if="loading">
    <section class="card empty">日报功能加载中...</section>
  </template>

  <template v-else-if="!featureEnabled">
    <section class="card">
      <h2>无权限</h2>
      <p>当前商家尚未开放营业日报功能。</p>
      <button class="secondary" type="button" @click="router.push('/orders')">
        返回订单管理
      </button>
    </section>
  </template>

  <template v-else>
    <section class="card form-grid report-settings-card">
      <div class="section-heading span-2">
        <div>
          <h2>日报设置</h2>
          <p>保存后可立即预览今日日报并进行 mock 测试发送。</p>
        </div>
      </div>

      <label class="check">
        <input v-model="form.enabled" type="checkbox" />
        开启日报推送
      </label>

      <label class="check">
        <input v-model="form.aiSuggestions" type="checkbox" />
        AI 建议
      </label>

      <label>
        Zalo 接收人
        <input v-model="form.zaloRecipient" type="text" placeholder="zalo_user_or_phone" />
      </label>

      <label>
        推送时间
        <input v-model="form.pushTime" type="time" step="60" />
      </label>

      <label>
        日报语言
        <select v-model="form.language">
          <option value="zh">中文</option>
          <option value="vi">越南语</option>
        </select>
      </label>

      <div class="report-actions span-2">
        <button class="secondary" type="button" :disabled="saving" @click="saveSettings">
          {{ saving ? '保存中...' : '保存设置' }}
        </button>
      </div>
    </section>

    <section class="card report-preview-card">
      <div class="section-heading">
        <div>
          <h2>今日日报预览</h2>
          <p>预览和发送都基于当前商家订单数据生成 PNG 长图。</p>
        </div>
        <div class="report-actions">
          <button class="secondary" type="button" :disabled="previewing" @click="loadPreview(form.language)">
            {{ previewing ? '预览中...' : '预览今日日报' }}
          </button>
          <button class="primary" type="button" :disabled="sending" @click="sendMockReport">
            {{ sending ? '发送中...' : '手动发送测试' }}
          </button>
        </div>
      </div>

      <div v-if="preview" class="report-preview-layout">
        <div class="report-preview-summary">
          <div class="report-metric">
            <span>今日订单数</span>
            <strong>{{ preview.summary.orderCount }}</strong>
          </div>
          <div class="report-metric">
            <span>今日营业额</span>
            <strong>{{ money(preview.summary.totalAmount) }}</strong>
          </div>
          <div class="report-metric">
            <span>平均客单价</span>
            <strong>{{ money(preview.summary.averageOrderAmount) }}</strong>
          </div>
          <div class="report-metric">
            <span>堂食 / 自取 / 配送</span>
            <strong>{{ preview.summary.dineInCount }} / {{ preview.summary.pickupCount }} / {{ preview.summary.deliveryCount }}</strong>
          </div>
          <div class="report-metric report-metric--wide">
            <span>高峰时段</span>
            <strong>{{ preview.summary.peakHour }} · {{ preview.summary.peakHourOrderCount }} 单</strong>
          </div>
          <div class="report-summary-group report-metric--wide">
            <span>订单状态</span>
            <div class="report-chip-list">
              <span v-for="[status, count] in statusEntries" :key="status" class="report-chip">
                {{ statusLabel(status) }}：{{ count }}
              </span>
            </div>
          </div>
          <div class="report-summary-group report-metric--wide">
            <span>热门菜品</span>
            <ul class="report-list">
              <li v-for="item in topProducts" :key="item.name">
                {{ item.name }} · {{ item.quantity }} 份
              </li>
              <li v-if="topProducts.length === 0" class="muted">暂无热门菜品</li>
            </ul>
          </div>
          <div class="report-summary-group report-metric--wide">
            <span>经营建议</span>
            <ul class="report-list">
              <li v-for="item in suggestions" :key="item">{{ item }}</li>
              <li v-if="suggestions.length === 0" class="muted">暂无建议</li>
            </ul>
          </div>
        </div>

        <div class="report-preview-image">
          <strong>{{ preview.merchantName }}</strong>
          <small>日期：{{ preview.reportDate }} · 语言：{{ preview.language }}</small>
          <img v-if="reportImageSrc" :src="reportImageSrc" alt="日报图片预览" />
          <p v-else class="empty">暂无图片预览</p>
        </div>
      </div>

      <p v-else class="empty">点击“预览今日日报”生成 PNG 长图预览。</p>
    </section>
  </template>
</template>

<style scoped>
.report-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}

.report-preview-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 1rem;
}

.report-preview-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.report-metric,
.report-summary-group {
  background: #f8fafc;
  border: 1px solid #dbeafe;
  border-radius: 18px;
  padding: 1rem;
}

.report-metric span,
.report-summary-group span,
.report-preview-image small {
  color: #6b7280;
}

.report-metric strong {
  display: block;
  margin-top: 0.4rem;
  font-size: 1.2rem;
}

.report-metric--wide,
.report-summary-group {
  grid-column: 1 / -1;
}

.report-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.report-chip {
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: #dcfce7;
  color: #166534;
  font-size: 0.85rem;
}

.report-list {
  margin: 0.75rem 0 0;
  padding-left: 1.2rem;
}

.report-preview-image {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.report-preview-image img {
  width: 100%;
  border-radius: 20px;
  border: 1px solid #dbeafe;
  background: #fff;
}

@media (max-width: 960px) {
  .report-preview-layout,
  .report-preview-summary {
    grid-template-columns: 1fr;
  }
}
</style>
