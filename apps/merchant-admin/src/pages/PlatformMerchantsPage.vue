<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createPlatformMerchant,
  deletePlatformMerchant,
  disablePlatformMerchant,
  enablePlatformMerchant,
  getPlatformMerchants,
  resetPlatformMerchantPassword,
  updatePlatformMerchant,
} from '@/api/platform';
import { useI18n, type TranslationKey } from '@/i18n';
import type { PlatformMerchantListItem } from '@/types/api';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const merchants = ref<PlatformMerchantListItem[]>([]);
const loading = ref(false);
const message = ref('');
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref('');
const filters = reactive({
  keyword: '',
  region: '',
  status: '',
  homepageCategory: '',
  popular: '',
});
const form = reactive({
  nameZh: '',
  contactPhone: '',
  homepageCategoryKeys: [] as string[],
  manualPopular: false,
  isVisibleOnClient: true,
  reportFeatureEnabled: false,
});

const isEditing = computed(() => dialogMode.value === 'edit');
const homepageCategoryOptions = computed(() => [
  { value: 'popular_food', label: t('homepageCategoryPopular') },
  { value: 'chinese_dining', label: t('homepageCategoryChinese') },
  { value: 'noodles_snacks', label: t('homepageCategoryNoodles') },
  { value: 'coffee_milk_tea', label: t('homepageCategoryDrinks') },
  { value: 'flowers_gifts', label: t('homepageCategoryFlowers') },
  { value: 'fresh_fruit', label: t('homepageCategoryFresh') },
  { value: 'convenience_store', label: t('homepageCategoryConvenience') },
  { value: 'vietnamese_food', label: t('homepageCategoryVietnamese') },
]);
const regionOptions = computed(() =>
  Array.from(
    new Set(
      merchants.value
        .map((item) => regionText(item))
        .filter((value) => value !== '-'),
    ),
  ).sort((left, right) => left.localeCompare(right, 'zh-CN')),
);
const filteredMerchants = computed(() =>
  merchants.value.filter((item) => {
    const keyword = filters.keyword.trim().toLowerCase();
    const matchesKeyword = !keyword || [
      item.id,
      item.nameZh,
      item.contactPhone,
      item.ownerUsername,
    ].some((value) => String(value ?? '').toLowerCase().includes(keyword));
    const matchesRegion = !filters.region || regionText(item) === filters.region;
    const matchesStatus = !filters.status || item.status === filters.status;
    const matchesCategory =
      !filters.homepageCategory ||
      item.homepageCategoryKeys.includes(filters.homepageCategory);
    const matchesPopular =
      !filters.popular ||
      (filters.popular === 'yes' ? item.manualPopular : !item.manualPopular);

    return (
      matchesKeyword &&
      matchesRegion &&
      matchesStatus &&
      matchesCategory &&
      matchesPopular
    );
  }),
);
const merchantSummary = computed(() => {
  const list = merchants.value;
  return {
    total: list.length,
    active: list.filter((item) => item.status === 'ACTIVE').length,
    pendingAcceptance: list.reduce(
      (sum, item) => sum + Number(item.pendingAcceptanceOrderCount ?? 0),
      0,
    ),
    todayOrderAmount: list.reduce(
      (sum, item) => sum + Number(item.todayOrderAmount ?? 0),
      0,
    ),
  };
});

onMounted(loadMerchants);

async function loadMerchants() {
  loading.value = true;
  message.value = '';
  try {
    merchants.value = await getPlatformMerchants();
    await openEditFromRoute();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  dialogMode.value = 'create';
  editingId.value = '';
  form.nameZh = '';
  form.contactPhone = '';
  form.homepageCategoryKeys = [];
  form.manualPopular = false;
  form.isVisibleOnClient = true;
  form.reportFeatureEnabled = false;
  dialogVisible.value = true;
  message.value = '';
}

function openEdit(item: PlatformMerchantListItem) {
  dialogMode.value = 'edit';
  editingId.value = item.id;
  form.nameZh = item.nameZh;
  form.contactPhone = item.contactPhone;
  form.homepageCategoryKeys = normalizeHomepageCategoryKeys(item.homepageCategoryKeys ?? []);
  form.manualPopular = Boolean(item.manualPopular);
  form.isVisibleOnClient = item.isVisibleOnClient !== false;
  form.reportFeatureEnabled = Boolean(item.reportFeatureEnabled);
  dialogVisible.value = true;
  message.value = '';
}

async function openEditFromRoute() {
  const editId = route.query.edit;
  if (typeof editId !== 'string' || !editId) return;
  const target = merchants.value.find((item) => item.id === editId);
  if (!target) return;
  openEdit(target);
  await router.replace({ path: '/platform/merchants' });
}

function openDetail(item: PlatformMerchantListItem) {
  router.push(`/platform/merchants/${item.id}`);
}

function closeDialog() {
  dialogVisible.value = false;
}

async function submit() {
  message.value = '';
  try {
    if (dialogMode.value === 'create') {
      const phone = form.contactPhone.trim();
      await createPlatformMerchant({
        phone,
        homepageCategoryKeys: [...form.homepageCategoryKeys],
        manualPopular: form.manualPopular,
        isVisibleOnClient: form.isVisibleOnClient,
        reportFeatureEnabled: form.reportFeatureEnabled,
      });
      message.value = `${t('merchantCreated')}\n${t('username')}：${phone}\n${t('password')}：12345678\n${t('mustChangePassword')}`;
    } else {
      await updatePlatformMerchant(editingId.value, {
        nameZh: form.nameZh,
        contactPhone: form.contactPhone,
        homepageCategoryKeys: [...form.homepageCategoryKeys],
        manualPopular: form.manualPopular,
        isVisibleOnClient: form.isVisibleOnClient,
        reportFeatureEnabled: form.reportFeatureEnabled,
      });
      message.value = t('merchantUpdated');
    }
    dialogVisible.value = false;
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function resetPassword(item: PlatformMerchantListItem) {
  if (!window.confirm(t('resetMerchantPasswordConfirm', { name: item.nameZh }))) {
    return;
  }
  try {
    await resetPlatformMerchantPassword(item.id);
    message.value = t('merchantPasswordReset');
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function toggleStatus(item: PlatformMerchantListItem) {
  const isActive = item.status === 'ACTIVE';
  const confirmed = window.confirm(
    isActive
      ? t('disableMerchantConfirm', { name: item.nameZh })
      : t('enableMerchantConfirm', { name: item.nameZh }),
  );
  if (!confirmed) return;
  try {
    if (isActive) {
      await disablePlatformMerchant(item.id);
      message.value = t('merchantDisabled');
    } else {
      await enablePlatformMerchant(item.id);
      message.value = t('merchantEnabled');
    }
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function removeMerchant(item: PlatformMerchantListItem) {
  if (!window.confirm(t('deleteMerchantConfirm', { name: item.nameZh }))) {
    return;
  }
  try {
    await deletePlatformMerchant(item.id);
    message.value = t('merchantDeleted');
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function statusLabel(status: PlatformMerchantListItem['status']) {
  if (status === 'ACTIVE') return '营业中';
  if (status === 'DISABLED') return '已停用';
  if (status === 'DELETED') return t('deletedStatus');
  return t('pendingStatus');
}

function visibilityLabel(value: boolean) {
  return value ? t('clientVisibilityEnabled') : t('clientVisibilityDisabled');
}

function missingProfileText(item: PlatformMerchantListItem) {
  if (!item.missingProfileFields.length) return '';
  return item.missingProfileFields.map((key) => t(key as TranslationKey)).join('、');
}

function toggleHomepageCategory(value: string) {
  if (form.homepageCategoryKeys.includes(value)) {
    form.homepageCategoryKeys = form.homepageCategoryKeys.filter((item) => item !== value);
    return;
  }
  form.homepageCategoryKeys = [...form.homepageCategoryKeys, value];
}

function homepageCategoryText(keys: string[]) {
  const labels = homepageCategoryOptions.value
    .filter((item) => keys.includes(item.value))
    .map((item) => item.label);
  return labels.length ? labels.join('、') : '未设置';
}

function homepageCategoryLabels(keys: string[]) {
  return homepageCategoryOptions.value.filter((item) => keys.includes(item.value));
}

function normalizeHomepageCategoryKeys(keys: string[]) {
  return Array.from(
    new Set(
      keys
        .map((key) => {
          if (key === 'chinese') return 'chinese_dining';
          if (key === 'noodles') return 'noodles_snacks';
          if (key === 'drinks') return 'coffee_milk_tea';
          return key;
        })
        .filter((key) => homepageCategoryOptions.value.some((item) => item.value === key)),
    ),
  );
}

function regionText(item: PlatformMerchantListItem) {
  return [item.city, item.district].filter(Boolean).join(' / ') || '-';
}

function money(value: string | number) {
  return `${Number(value).toLocaleString()} ₫`;
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

function merchantInitial(name: string) {
  return name.trim().slice(0, 1) || '商';
}

function resetFilters() {
  filters.keyword = '';
  filters.region = '';
  filters.status = '';
  filters.homepageCategory = '';
  filters.popular = '';
}
</script>

<template>
  <PageHeader
    :title="t('merchantManagement')"
    description="管理平台入驻商户、营业状态、首页分类、热门推荐和经营数据"
  >
    <button class="platform-primary-action" @click="openCreate">{{ t('createMerchant') }}</button>
  </PageHeader>

  <p v-if="message" class="message">{{ message }}</p>

  <section class="platform-metric-grid platform-merchant-summary-grid">
    <article class="card platform-metric-card">
      <span>商家总数</span>
      <strong>{{ merchantSummary.total }}</strong>
      <small>当前未删除商家</small>
    </article>
    <article class="card platform-metric-card">
      <span>营业中商家</span>
      <strong>{{ merchantSummary.active }}</strong>
      <small>状态为营业中</small>
    </article>
    <article class="card platform-metric-card">
      <span>待接单订单</span>
      <strong>{{ merchantSummary.pendingAcceptance }}</strong>
      <small>跨商家待处理</small>
    </article>
    <article class="card platform-metric-card highlight">
      <span>今日订单金额</span>
      <strong>{{ money(merchantSummary.todayOrderAmount) }}</strong>
      <small>按当前列表汇总</small>
    </article>
  </section>

  <div v-if="dialogVisible" class="modal-backdrop" @click.self="closeDialog">
    <form class="card modal-card form-grid" @submit.prevent="submit">
      <h2>{{ isEditing ? t('editMerchant') : t('createMerchant') }}</h2>
      <label v-if="isEditing" class="span-2">{{ t('chineseName') }}<input v-model="form.nameZh" required maxlength="120" /></label>
      <label class="span-2">{{ t('contactPhone') }}<input v-model="form.contactPhone" required maxlength="32" /></label>
      <section class="span-2 platform-homepage-categories">
        <strong>{{ t('homepageCategories') }}</strong>
        <div class="platform-category-options">
          <label
            v-for="item in homepageCategoryOptions"
            :key="item.value"
            class="platform-category-option"
            :class="{ selected: form.homepageCategoryKeys.includes(item.value) }"
          >
            <input
              type="checkbox"
              :checked="form.homepageCategoryKeys.includes(item.value)"
              @change="toggleHomepageCategory(item.value)"
            />
            <span>{{ item.label }}</span>
          </label>
        </div>
      </section>
      <label class="span-2 check">
        <input v-model="form.manualPopular" type="checkbox" />
        <span>{{ t('manualPopular') }}</span>
      </label>
      <label class="span-2 check visibility-check">
        <input v-model="form.isVisibleOnClient" type="checkbox" />
        <div>
          <strong>{{ t('clientVisibility') }}</strong>
          <p class="hint">
            {{ form.isVisibleOnClient ? t('clientVisibilityHint') : t('clientVisibilityDisabledHint') }}
          </p>
        </div>
      </label>
      <label class="span-2 check visibility-check">
        <input v-model="form.reportFeatureEnabled" type="checkbox" />
        <div>
          <strong>开放营业日报功能</strong>
          <p class="hint">开启后，该商家后台将显示“营业日报”功能，可配置日报预览和测试发送。</p>
        </div>
      </label>
      <p class="span-2 hint">{{ t('manualPopularHint') }}</p>
      <p v-if="!isEditing" class="span-2 hint">{{ t('merchantNameAutoGenerated') }}</p>
      <p class="span-2 hint">{{ t('defaultPasswordHint') }}</p>
      <div class="form-actions span-2">
        <button class="secondary" type="button" @click="closeDialog">{{ t('cancel') }}</button>
        <button type="submit">{{ t('saveChanges') }}</button>
      </div>
    </form>
  </div>

  <section class="card platform-merchant-filters">
    <label>
      搜索商家名称 / ID
      <input v-model="filters.keyword" placeholder="输入商户名称、ID、手机号" />
    </label>
    <label>
      城市 / 区域
      <select v-model="filters.region">
        <option value="">全部区域</option>
        <option v-for="item in regionOptions" :key="item" :value="item">{{ item }}</option>
      </select>
    </label>
    <label>
      营业状态
      <select v-model="filters.status">
        <option value="">全部状态</option>
        <option value="ACTIVE">营业中</option>
        <option value="PENDING">{{ t('pendingStatus') }}</option>
        <option value="DISABLED">已停用</option>
      </select>
    </label>
    <label>
      首页分类
      <select v-model="filters.homepageCategory">
        <option value="">全部分类</option>
        <option
          v-for="item in homepageCategoryOptions"
          :key="item.value"
          :value="item.value"
        >
          {{ item.label }}
        </option>
      </select>
    </label>
    <label>
      热门推荐
      <select v-model="filters.popular">
        <option value="">全部</option>
        <option value="yes">已推荐</option>
        <option value="no">未推荐</option>
      </select>
    </label>
    <button class="secondary" type="button" @click="resetFilters">重置筛选</button>
  </section>

  <section class="card platform-merchant-card">
    <div class="platform-table-header">
      <div>
        <h2>商家列表</h2>
        <p>共 {{ filteredMerchants.length }} 个商户</p>
      </div>
      <button class="secondary" :disabled="loading" @click="loadMerchants">
        {{ loading ? '加载中...' : '刷新' }}
      </button>
    </div>

    <div class="table-wrap platform-merchant-table-wrap">
    <table class="platform-merchant-table">
      <thead>
        <tr>
          <th>商户信息</th>
          <th>城市 / 区域</th>
          <th>营业状态</th>
          <th>{{ t('clientVisibility') }}</th>
          <th>{{ t('homepageCategories') }}</th>
          <th>{{ t('manualPopular') }}</th>
          <th>今日订单</th>
          <th>待接单</th>
          <th>今日订单金额</th>
          <th>近 7 日订单</th>
          <th>最近订单时间</th>
          <th>{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filteredMerchants" :key="item.id">
          <td>
            <div class="merchant-info-cell">
              <div class="merchant-avatar">{{ merchantInitial(item.nameZh) }}</div>
              <div>
                <strong>{{ item.nameZh }}</strong>
                <small>{{ item.contactPhone }} · ID: {{ item.id }}</small>
                <small :title="missingProfileText(item)">
                  {{ t('profileCompletion') }} {{ item.profileCompletion }}%
                </small>
              </div>
            </div>
          </td>
          <td>{{ regionText(item) }}</td>
          <td>
            <span
              class="status-pill"
              :class="item.status === 'ACTIVE' ? 'is-active' : item.status === 'DISABLED' ? 'is-disabled' : 'is-muted'"
            >
              {{ statusLabel(item.status) }}
            </span>
          </td>
          <td>
            <span class="status-pill" :class="item.isVisibleOnClient ? 'is-active' : 'is-muted'">
              {{ visibilityLabel(item.isVisibleOnClient) }}
            </span>
          </td>
          <td>
            <div v-if="homepageCategoryLabels(item.homepageCategoryKeys).length" class="tag-list">
              <span
                v-for="category in homepageCategoryLabels(item.homepageCategoryKeys)"
                :key="category.value"
                class="category-tag"
              >
                {{ category.label }}
              </span>
            </div>
            <span v-else class="muted-text">{{ homepageCategoryText(item.homepageCategoryKeys) }}</span>
          </td>
          <td>
            <span class="popular-pill" :class="{ active: item.manualPopular }">
              {{ item.manualPopular ? '已推荐' : '未推荐' }}
            </span>
          </td>
          <td>
            <strong>{{ item.todayOrderCount }}</strong>
            <small>单</small>
          </td>
          <td>
            <span
              class="pending-count"
              :class="{ urgent: item.pendingAcceptanceOrderCount > 0 }"
            >
              待接：{{ item.pendingAcceptanceOrderCount }}
            </span>
          </td>
          <td>{{ money(item.todayOrderAmount) }}</td>
          <td>{{ item.last7DaysOrderCount }} 单</td>
          <td>{{ dateTime(item.lastOrderAt) }}</td>
          <td>
            <div class="merchant-actions">
              <button class="small secondary" @click="openDetail(item)">查看</button>
              <button class="small secondary" @click="openEdit(item)">{{ t('edit') }}</button>
              <button class="small subtle" @click="resetPassword(item)">{{ t('resetPassword') }}</button>
              <button class="small warning" @click="toggleStatus(item)">{{ item.status === 'ACTIVE' ? t('disable') : t('enabled') }}</button>
              <button class="small danger" @click="removeMerchant(item)">{{ t('deleteMerchant') }}</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    <p v-if="loading" class="empty">商户数据加载中...</p>
    <p v-else-if="filteredMerchants.length === 0" class="empty">{{ t('noMatchingMerchants') }}</p>
  </section>
</template>

<style scoped>
.platform-homepage-categories {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #d8e6dc;
  border-radius: 10px;
  background: #f8fcf9;
}

.platform-homepage-categories strong {
  font-size: 16px;
}

.platform-category-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.platform-category-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 120px;
  height: 44px;
  padding: 0 16px;
  border: 1px solid #cfe0d4;
  border-radius: 8px;
  background: #ffffff;
  color: #21412a;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 1px 0 rgba(16, 24, 40, 0.02);
}

.platform-category-option.selected {
  border-color: #20a464;
  background: #eefaf3;
  color: #12683d;
}

.platform-category-option input {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  accent-color: #20a464;
}

.platform-category-option span {
  display: inline-block;
  white-space: nowrap;
}
</style>
