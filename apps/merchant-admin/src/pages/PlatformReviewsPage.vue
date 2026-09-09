<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getPlatformReviews, moderatePlatformReview } from '@/api/platform';
import { resolveMediaUrl } from '@/utils/media';
import type {
  PlatformReviewFilters,
  PlatformReviewListItem,
  PlatformReviewModerationCheck,
  PlatformReviewsResponse,
  PlatformReviewStatus,
} from '@/types/api';

const response = ref<PlatformReviewsResponse | null>(null);
const selectedReview = ref<PlatformReviewListItem | null>(null);
const loading = ref(false);
const acting = ref(false);
const message = ref('');
const messageTone = ref<'error' | 'success'>('error');
const filters = reactive<Required<Pick<PlatformReviewFilters, 'page' | 'pageSize'>> & PlatformReviewFilters>({
  status: '',
  riskOnly: false,
  keyword: '',
  page: 1,
  pageSize: 20,
});

const rows = computed(() => response.value?.items ?? []);
const totalPages = computed(() =>
  Math.max(1, Math.ceil((response.value?.total ?? 0) / filters.pageSize)),
);
const statusOptions = computed<Array<{ value: PlatformReviewStatus | ''; label: string; count?: number }>>(() => [
  { value: '', label: '全部', count: undefined },
  { value: 'PENDING_REVIEW', label: '待审核', count: response.value?.summary.pending },
  { value: 'PUBLISHED', label: '已公开', count: response.value?.summary.published },
  { value: 'HIDDEN', label: '已隐藏', count: response.value?.summary.hidden },
]);

onMounted(() => void loadReviews());

async function loadReviews() {
  loading.value = true;
  message.value = '';
  try {
    response.value = await getPlatformReviews(filters);
    if (selectedReview.value) {
      selectedReview.value = rows.value.find((item) => item.id === selectedReview.value?.id) ?? null;
    }
  } catch (error) {
    showMessage(errorMessage(error), 'error');
  } finally {
    loading.value = false;
  }
}

function chooseStatus(status: PlatformReviewStatus | '') {
  filters.status = status;
  filters.page = 1;
  void loadReviews();
}

function search() {
  filters.page = 1;
  void loadReviews();
}

function toggleRiskOnly() {
  filters.riskOnly = !filters.riskOnly;
  filters.page = 1;
  void loadReviews();
}

function resetFilters() {
  filters.status = '';
  filters.riskOnly = false;
  filters.keyword = '';
  filters.page = 1;
  void loadReviews();
}

function goPage(page: number) {
  filters.page = Math.min(Math.max(1, page), totalPages.value);
  void loadReviews();
}

async function runAction(action: 'hide' | 'publish' | 'restore') {
  const review = selectedReview.value;
  if (!review || acting.value) return;
  acting.value = true;
  message.value = '';
  try {
    selectedReview.value = await moderatePlatformReview(review.id, action);
    showMessage(actionMessage(action), 'success');
    await loadReviews();
  } catch (error) {
    showMessage(errorMessage(error), 'error');
  } finally {
    acting.value = false;
  }
}

function showMessage(value: string, tone: 'error' | 'success') {
  message.value = value;
  messageTone.value = tone;
}

function actionMessage(action: 'hide' | 'publish' | 'restore') {
  if (action === 'hide') return '评价已隐藏，不再对用户公开。';
  if (action === 'restore') return '评价已恢复公开。';
  return '评价已通过并公开。';
}

function statusLabel(status: PlatformReviewStatus) {
  if (status === 'PENDING_REVIEW') return '待审核';
  if (status === 'PUBLISHED') return '已公开';
  return '已隐藏';
}

function sourceLabel(review: PlatformReviewListItem) {
  return review.source === 'ORDER' ? '消费后评价' : '直接评价';
}

function authorLabel(review: PlatformReviewListItem) {
  return review.author.nickname?.trim() || `用户 ${review.author.id}`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function reviewExcerpt(review: PlatformReviewListItem) {
  const value = review.content?.trim() || '仅评分，未填写文字';
  return value.length > 54 ? `${value.slice(0, 54)}…` : value;
}

function checkTypeLabel(check: PlatformReviewModerationCheck) {
  if (check.type === 'LOCAL_TEXT') return '服务端规则';
  if (check.type === 'WECHAT_TEXT') return '微信文本安全';
  return '微信图片安全';
}

function checkStatusLabel(check: PlatformReviewModerationCheck) {
  if (check.status === 'PASS') return '通过';
  if (check.status === 'PENDING') return '检查中';
  if (check.status === 'REVIEW') return '需复核';
  if (check.status === 'RISKY') return '高风险';
  return '检查异常';
}

function checkReason(check: PlatformReviewModerationCheck) {
  const reasons = check.reasonCodes.map(reasonLabel);
  if (check.errorCode) reasons.push(errorLabel(check.errorCode));
  if (check.providerLabel !== null) reasons.push(`微信标签 ${check.providerLabel}`);
  return [...new Set(reasons)].join(' · ') || '未发现风险';
}

function reasonLabel(code: string) {
  if (code === 'PROFANITY') return '疑似辱骂或脏话';
  if (code === 'CONTACT_INFORMATION') return '疑似联系方式或引流信息';
  if (code.startsWith('WECHAT_LABEL_')) return `微信风险标签 ${code.replace('WECHAT_LABEL_', '')}`;
  return code;
}

function errorLabel(code: string) {
  const labels: Record<string, string> = {
    WECHAT_CHECK_DISABLED: '微信检查未启用',
    WECHAT_OPENID_MISSING: '用户 OpenID 缺失',
    WECHAT_CREDENTIALS_MISSING: '微信服务配置缺失',
    WECHAT_REQUEST_FAILED: '微信检查暂时不可用',
    WECHAT_TRACE_ID_MISSING: '微信未返回检查编号',
    WECHAT_RESULT_INVALID: '微信文本结果无法识别',
    WECHAT_CALLBACK_RESULT_INVALID: '微信图片结果无法识别',
    PUBLIC_MEDIA_URL_UNAVAILABLE: '图片公网地址未配置',
  };
  return labels[code] ?? `检查异常 ${code}`;
}

function riskSummary(review: PlatformReviewListItem) {
  const checks = review.moderationChecks.filter((check) => check.status !== 'PASS');
  if (!checks.length) return '全部通过';
  if (checks.some((check) => check.status === 'RISKY')) return '高风险';
  if (checks.some((check) => check.status === 'REVIEW')) return '需人工复核';
  if (checks.some((check) => check.status === 'ERROR')) return '检查异常';
  return '检查中';
}

function riskClass(review: PlatformReviewListItem) {
  const statuses = review.moderationChecks.map((check) => check.status);
  if (statuses.includes('RISKY')) return 'risky';
  if (statuses.includes('REVIEW')) return 'review';
  if (statuses.includes('ERROR')) return 'error';
  if (statuses.includes('PENDING')) return 'pending';
  return 'pass';
}

function statusClass(status: PlatformReviewStatus) {
  if (status === 'PENDING_REVIEW') return 'pending';
  if (status === 'PUBLISHED') return 'published';
  return 'hidden';
}
</script>

<template>
  <div class="review-moderation-page">
    <PageHeader
      title="评价审核"
      description="查看评价内容安全结果，并控制待审核、公开与隐藏状态"
    >
      <button class="secondary" :disabled="loading" @click="loadReviews">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </PageHeader>

    <p v-if="message" class="review-message" :class="messageTone" role="status">
      {{ message }}
    </p>

    <section class="card review-toolbar" aria-label="评价筛选">
      <div class="status-tabs" role="tablist" aria-label="评价状态">
        <button
          v-for="option in statusOptions"
          :key="option.value || 'all'"
          type="button"
          role="tab"
          :aria-selected="filters.status === option.value"
          :class="['status-tab', { active: filters.status === option.value }]"
          @click="chooseStatus(option.value)"
        >
          {{ option.label }}
          <span v-if="option.count !== undefined">{{ option.count }}</span>
        </button>
      </div>

      <div class="review-search-row">
        <label class="review-search">
          搜索评价
          <input
            v-model="filters.keyword"
            type="search"
            placeholder="商家、用户、订单号或评价内容"
            @keyup.enter="search"
          />
        </label>
        <button
          type="button"
          class="risk-filter"
          :class="{ active: filters.riskOnly }"
          :aria-pressed="filters.riskOnly"
          @click="toggleRiskOnly"
        >
          风险与异常 {{ response?.summary.risk ?? 0 }}
        </button>
        <button type="button" @click="search">查询</button>
        <button type="button" class="secondary" @click="resetFilters">重置</button>
      </div>
    </section>

    <section class="card review-list-card">
      <div class="platform-table-header">
        <div>
          <h2>评价列表</h2>
          <p>共 {{ response?.total ?? 0 }} 条，风险内容默认不会公开</p>
        </div>
        <label class="page-size-control">
          每页
          <select v-model.number="filters.pageSize" @change="search">
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
          </select>
        </label>
      </div>

      <div class="table-wrap">
        <table class="review-table">
          <thead>
            <tr>
              <th>状态</th>
              <th>商家 / 来源</th>
              <th>用户 / 评分</th>
              <th>评价内容</th>
              <th>内容安全</th>
              <th>提交时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody v-if="!loading">
            <tr v-for="review in rows" :key="review.id">
              <td>
                <span class="review-status" :class="statusClass(review.status)">
                  {{ statusLabel(review.status) }}
                </span>
              </td>
              <td>
                <strong>{{ review.merchant.nameZh }}</strong>
                <small>{{ sourceLabel(review) }}{{ review.order ? ` · ${review.order.orderNo}` : '' }}</small>
              </td>
              <td>
                <strong>{{ authorLabel(review) }}</strong>
                <small>{{ '★'.repeat(review.rating) }}{{ review.isAnonymous ? ' · 匿名展示' : '' }}</small>
              </td>
              <td class="review-content-cell">
                <span>{{ reviewExcerpt(review) }}</span>
                <small v-if="review.images.length">{{ review.images.length }} 张图片</small>
              </td>
              <td>
                <span class="risk-status" :class="riskClass(review)">
                  {{ riskSummary(review) }}
                </span>
              </td>
              <td>{{ dateTime(review.createdAt) }}</td>
              <td>
                <button type="button" class="small secondary" @click="selectedReview = review">
                  查看与处理
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="loading" class="review-skeletons" aria-label="评价加载中">
          <div v-for="index in 4" :key="index" class="review-skeleton" />
        </div>
        <div v-else-if="rows.length === 0" class="review-empty">
          <strong>暂无符合条件的评价</strong>
          <span>调整状态、关键词或风险筛选后再试。</span>
          <button type="button" class="secondary" @click="resetFilters">清除筛选</button>
        </div>
      </div>

      <div class="platform-pagination">
        <button class="secondary small" :disabled="filters.page <= 1" @click="goPage(filters.page - 1)">上一页</button>
        <span>第 {{ filters.page }} / {{ totalPages }} 页</span>
        <button class="secondary small" :disabled="filters.page >= totalPages" @click="goPage(filters.page + 1)">下一页</button>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="selectedReview" class="review-drawer-mask" @click.self="selectedReview = null">
        <aside class="review-drawer" aria-label="评价审核详情">
          <header class="review-drawer-header">
            <div>
              <span class="review-status" :class="statusClass(selectedReview.status)">
                {{ statusLabel(selectedReview.status) }}
              </span>
              <h2>{{ selectedReview.merchant.nameZh }}</h2>
              <p>{{ sourceLabel(selectedReview) }} · {{ dateTime(selectedReview.createdAt) }}</p>
            </div>
            <button type="button" class="drawer-close" aria-label="关闭" @click="selectedReview = null">×</button>
          </header>

          <div class="review-drawer-scroll">
            <section class="review-detail-section">
              <div class="review-detail-heading">
                <h3>评价内容</h3>
                <span>{{ '★'.repeat(selectedReview.rating) }}</span>
              </div>
              <p class="review-full-content">{{ selectedReview.content || '仅评分，未填写文字' }}</p>
              <div v-if="selectedReview.images.length" class="review-image-grid">
                <a
                  v-for="image in selectedReview.images"
                  :key="image.id"
                  :href="`${resolveMediaUrl(image.imageUrl)}`"
                  target="_blank"
                  rel="noreferrer"
                >
                  <img :src="`${resolveMediaUrl(image.imageUrl)}`" alt="评价图片" />
                </a>
              </div>
              <dl class="review-facts">
                <div><dt>用户</dt><dd>{{ authorLabel(selectedReview) }} · ID {{ selectedReview.author.id }}</dd></div>
                <div><dt>公开身份</dt><dd>{{ selectedReview.isAnonymous ? '匿名' : '显示昵称' }}</dd></div>
                <div><dt>评价来源</dt><dd>{{ sourceLabel(selectedReview) }}</dd></div>
              </dl>
            </section>

            <section class="review-detail-section">
              <div class="review-detail-heading">
                <h3>内容安全记录</h3>
                <span class="risk-status" :class="riskClass(selectedReview)">{{ riskSummary(selectedReview) }}</span>
              </div>
              <div class="check-list">
                <article v-for="check in selectedReview.moderationChecks" :key="check.id" class="check-row">
                  <span class="check-dot" :class="check.status.toLowerCase()" aria-hidden="true" />
                  <div>
                    <strong>{{ checkTypeLabel(check) }}</strong>
                    <p>{{ checkStatusLabel(check) }} · {{ checkReason(check) }}</p>
                    <small v-if="check.providerTraceId">检查编号 {{ check.providerTraceId }}</small>
                  </div>
                </article>
                <p v-if="!selectedReview.moderationChecks.length" class="review-muted">
                  该评价创建于内容安全功能启用前，暂无检查记录。
                </p>
              </div>
            </section>

            <section v-if="selectedReview.moderationActions.length" class="review-detail-section">
              <h3>人工操作记录</h3>
              <ul class="action-history">
                <li v-for="entry in selectedReview.moderationActions" :key="entry.id">
                  <span>{{ dateTime(entry.createdAt) }}</span>
                  <strong>{{ entry.actorUsername }}</strong>
                  <span>{{ statusLabel(entry.fromStatus) }} → {{ statusLabel(entry.toStatus) }}</span>
                </li>
              </ul>
            </section>
          </div>

          <footer class="review-drawer-actions">
            <p v-if="selectedReview.status === 'PENDING_REVIEW'">
              人工确认内容合规后才可公开。
            </p>
            <p v-else-if="selectedReview.status === 'HIDDEN'">
              恢复后评价会重新出现在商家公开评价中。
            </p>
            <p v-else>隐藏后评价会立即从公开列表移除。</p>
            <div>
              <button
                v-if="selectedReview.status === 'PENDING_REVIEW'"
                type="button"
                :disabled="acting"
                @click="runAction('publish')"
              >{{ acting ? '处理中…' : '通过并公开' }}</button>
              <button
                v-if="selectedReview.status !== 'HIDDEN'"
                type="button"
                class="danger"
                :disabled="acting"
                @click="runAction('hide')"
              >隐藏评价</button>
              <button
                v-if="selectedReview.status === 'HIDDEN'"
                type="button"
                :disabled="acting"
                @click="runAction('restore')"
              >{{ acting ? '处理中…' : '恢复公开' }}</button>
            </div>
          </footer>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* finesse · register=product · palette=incumbent-sage · layout=risk-first-review-queue
 * engine=feedback-only · material=real-review-content · SOUL=5 SPECTACLE=1 DENSITY=9 */
.review-moderation-page,
.review-drawer-mask {
  --review-ink: #1a202c;
  --review-muted: #667085;
  --review-surface: #fbfdfb;
  --review-surface-soft: #f2f7f3;
  --review-border: #dfe9e1;
  --review-accent: #146d2b;
  --review-accent-soft: #e1f2e5;
  --review-warn: #9a5a00;
  --review-warn-soft: #fff3df;
  --review-risk: #b42318;
  --review-risk-soft: #fff0ed;
  --review-neutral: #596579;
  --review-neutral-soft: #edf1f5;
  --review-shadow: rgb(30 62 39 / 16%);
  --review-mask: rgb(16 24 18 / 36%);
}

.review-moderation-page {
  min-width: 0;
}

.review-message {
  margin: 0 0 14px;
  padding: 11px 14px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
}

.review-message.error {
  color: var(--review-risk);
  background: var(--review-risk-soft);
}

.review-message.success {
  color: var(--review-accent);
  background: var(--review-accent-soft);
}

.review-toolbar {
  display: grid;
  gap: 16px;
  margin-bottom: 16px;
  padding: 16px 18px;
}

.status-tabs,
.review-search-row,
.review-drawer-actions > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.status-tab,
.review-moderation-page .risk-filter {
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid transparent;
  color: var(--review-muted);
  background: transparent;
  box-shadow: none;
}

.status-tab:hover:not(:disabled),
.status-tab.active,
.review-moderation-page .risk-filter:hover:not(:disabled),
.review-moderation-page .risk-filter.active {
  border-color: var(--review-border);
  color: var(--review-accent);
  background: var(--review-accent-soft);
}

.status-tab span {
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
}

.review-search-row {
  align-items: end;
}

.review-search {
  min-width: min(360px, 100%);
  flex: 1;
}

.review-search-row > button {
  white-space: nowrap;
}

.review-list-card {
  overflow: hidden;
  padding: 0;
}

.review-table {
  min-width: 1080px;
}

.review-content-cell {
  width: 30%;
  max-width: 420px;
}

.review-content-cell > span {
  display: block;
  line-height: 1.55;
}

.review-status,
.risk-status {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 4px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.review-status.pending,
.risk-status.pending,
.risk-status.review {
  color: var(--review-warn);
  background: var(--review-warn-soft);
}

.review-status.published,
.risk-status.pass {
  color: var(--review-accent);
  background: var(--review-accent-soft);
}

.review-status.hidden {
  color: var(--review-neutral);
  background: var(--review-neutral-soft);
}

.risk-status.risky,
.risk-status.error {
  color: var(--review-risk);
  background: var(--review-risk-soft);
}

.review-skeletons {
  display: grid;
  gap: 1px;
  background: var(--review-border);
}

.review-skeleton {
  height: 58px;
  background: linear-gradient(
    90deg,
    var(--review-surface) 0%,
    var(--review-surface-soft) 48%,
    var(--review-surface) 100%
  );
  background-size: 220% 100%;
  animation: review-loading 1.2s ease-in-out infinite;
}

.review-empty {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 48px 20px;
  color: var(--review-muted);
  text-align: center;
}

.review-empty strong {
  color: var(--review-ink);
}

.review-empty button {
  margin-top: 8px;
}

.review-drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  justify-content: flex-end;
  background: var(--review-mask);
}

.review-drawer {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(620px, 100%);
  min-height: 100dvh;
  color: var(--review-ink);
  background: var(--review-surface);
  box-shadow: -24px 0 70px -40px var(--review-shadow);
}

.review-drawer-header,
.review-drawer-actions {
  padding: 20px 22px;
  border-bottom: 1px solid var(--review-border);
}

.review-drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.review-drawer-header h2 {
  margin: 10px 0 2px;
  font-size: 22px;
}

.review-drawer-header p,
.review-drawer-actions p {
  margin: 0;
  color: var(--review-muted);
  font-size: 13px;
  line-height: 1.55;
}

.review-drawer .drawer-close {
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--review-muted);
  background: var(--review-surface-soft);
  font-size: 25px;
  font-weight: 400;
}

.review-drawer-scroll {
  overflow-y: auto;
  padding: 18px 22px 28px;
}

.review-detail-section {
  padding: 18px;
  border: 1px solid var(--review-border);
  border-radius: 14px;
  background: var(--review-surface);
  box-shadow: 0 1px 3px var(--review-shadow);
}

.review-detail-section + .review-detail-section {
  margin-top: 14px;
}

.review-detail-section h3 {
  margin: 0;
  font-size: 16px;
}

.review-detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.review-detail-heading > span:not(.risk-status) {
  color: var(--review-warn);
  letter-spacing: 1px;
}

.review-full-content {
  margin: 14px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.75;
}

.review-image-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}

.review-image-grid a {
  min-width: 0;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 10px;
  background: var(--review-surface-soft);
}

.review-image-grid img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.review-facts {
  display: grid;
  gap: 9px;
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--review-border);
}

.review-facts div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
}

.review-facts dt,
.review-facts dd {
  margin: 0;
}

.review-facts dt {
  color: var(--review-muted);
}

.check-list {
  display: grid;
  gap: 0;
  margin-top: 14px;
}

.check-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid var(--review-border);
}

.check-row:first-child {
  border-top: 0;
}

.check-row p,
.check-row small {
  display: block;
  margin: 4px 0 0;
  color: var(--review-muted);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.check-dot {
  width: 9px;
  height: 9px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--review-neutral);
}

.check-dot.pass {
  background: var(--review-accent);
}

.check-dot.pending,
.check-dot.review {
  background: var(--review-warn);
}

.check-dot.risky,
.check-dot.error {
  background: var(--review-risk);
}

.review-muted {
  color: var(--review-muted);
}

.action-history {
  display: grid;
  gap: 9px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.action-history li {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr) auto;
  gap: 10px;
  color: var(--review-muted);
  font-size: 13px;
}

.action-history strong {
  color: var(--review-ink);
}

.review-drawer-actions {
  border-top: 1px solid var(--review-border);
  border-bottom: 0;
  background: var(--review-surface);
}

.review-drawer-actions > div {
  justify-content: flex-end;
  margin-top: 12px;
}

@keyframes review-loading {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

@media (max-width: 760px) {
  .review-search-row {
    align-items: stretch;
  }

  .review-search,
  .review-search-row > button {
    width: 100%;
  }

  .review-drawer-header,
  .review-drawer-scroll,
  .review-drawer-actions {
    padding-left: 16px;
    padding-right: 16px;
  }

  .action-history li {
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .review-skeleton {
    animation: none;
    background: var(--review-surface-soft);
  }
}
</style>
