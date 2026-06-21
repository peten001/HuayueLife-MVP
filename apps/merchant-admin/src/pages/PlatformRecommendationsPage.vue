<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getPlatformMerchants, updatePlatformMerchant } from '@/api/platform';
import type { PlatformMerchantListItem } from '@/types/api';

type CategoryKey = 'popular' | 'chinese' | 'noodles' | 'drinks';

const router = useRouter();
const merchants = ref<PlatformMerchantListItem[]>([]);
const loading = ref(false);
const message = ref('');
const activeCategory = ref<CategoryKey>('popular');
const pickerVisible = ref(false);
const pickerSavingId = ref('');

const draftFilters = reactive({
  keyword: '',
  city: '',
});

const appliedFilters = reactive({
  keyword: '',
  city: '',
});

const pickerFilters = reactive({
  keyword: '',
  city: '',
});

const categories: Array<{
  key: CategoryKey;
  title: string;
  description: string;
}> = [
  { key: 'popular', title: '热门美食', description: '由平台手动推荐' },
  { key: 'chinese', title: '中式正餐', description: '商家首页分类 chinese' },
  { key: 'noodles', title: '粉面小吃', description: '商家首页分类 noodles' },
  { key: 'drinks', title: '茶饮甜品', description: '商家首页分类 drinks' },
];

const categoryLabelMap: Record<CategoryKey, string> = {
  popular: '热门美食',
  chinese: '中式正餐',
  noodles: '粉面小吃',
  drinks: '茶饮甜品',
};

const cityOptions = computed(() =>
  Array.from(
    new Set(
      merchants.value
        .map((item) => item.city?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right, 'zh-CN')),
);

const appliedMerchants = computed(() =>
  merchants.value.filter((item) => {
    const keyword = appliedFilters.keyword.trim().toLowerCase();
    const matchesKeyword =
      !keyword ||
      [item.id, item.nameZh, item.contactPhone, item.ownerUsername]
        .map((value) => String(value ?? '').toLowerCase())
        .some((value) => value.includes(keyword));
    const matchesCity = !appliedFilters.city || item.city === appliedFilters.city;
    return matchesKeyword && matchesCity;
  }),
);

const activeCategoryMeta = computed(
  () => categories.find((item) => item.key === activeCategory.value) ?? categories[0],
);

const activeCategoryMerchants = computed(() =>
  appliedMerchants.value
    .filter((item) => merchantInCategory(item, activeCategory.value))
    .sort((left, right) => compareMerchants(left, right)),
);

const overviewCards = computed(() =>
  categories.map((category) => {
    const list = appliedMerchants.value.filter((item) => merchantInCategory(item, category.key));
    return {
      ...category,
      merchantCount: list.length,
      todayOrderCount: list.reduce((sum, item) => sum + Number(item.todayOrderCount ?? 0), 0),
      todayOrderAmount: list.reduce((sum, item) => sum + Number(item.todayOrderAmount ?? 0), 0),
      last7DaysOrderCount: list.reduce((sum, item) => sum + Number(item.last7DaysOrderCount ?? 0), 0),
    };
  }),
);
const recommendationSummary = computed(() => ({
  merchantCount: appliedMerchants.value.length,
  recommendedCount: appliedMerchants.value.filter((item) => item.manualPopular).length,
  categorizedCount: appliedMerchants.value.filter((item) => (item.homepageCategoryKeys ?? []).length > 0).length,
  todayOrderAmount: appliedMerchants.value.reduce((sum, item) => sum + Number(item.todayOrderAmount ?? 0), 0),
}));

const pickerMerchantList = computed(() =>
  merchants.value
    .filter((item) => {
      const keyword = pickerFilters.keyword.trim().toLowerCase();
      const matchesKeyword =
        !keyword ||
        [item.id, item.nameZh, item.contactPhone, item.ownerUsername]
          .map((value) => String(value ?? '').toLowerCase())
          .some((value) => value.includes(keyword));
      const matchesCity = !pickerFilters.city || item.city === pickerFilters.city;
      return matchesKeyword && matchesCity;
    })
    .sort((left, right) => compareMerchants(left, right)),
);

onMounted(loadMerchants);

async function loadMerchants() {
  loading.value = true;
  message.value = '';
  try {
    merchants.value = await getPlatformMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function applyFilters() {
  appliedFilters.keyword = draftFilters.keyword.trim();
  appliedFilters.city = draftFilters.city.trim();
}

function resetFilters() {
  draftFilters.keyword = '';
  draftFilters.city = '';
  appliedFilters.keyword = '';
  appliedFilters.city = '';
  message.value = '';
}

function openPicker(category: CategoryKey) {
  activeCategory.value = category;
  pickerFilters.keyword = '';
  pickerFilters.city = '';
  pickerVisible.value = true;
  message.value = '';
}

function closePicker() {
  pickerVisible.value = false;
}

function resetPickerFilters() {
  pickerFilters.keyword = '';
  pickerFilters.city = '';
}

function goMerchantDetail(id: string) {
  router.push(`/platform/merchants/${id}`);
}

function merchantInCategory(item: PlatformMerchantListItem, category: CategoryKey) {
  if (category === 'popular') return Boolean(item.manualPopular);
  return (item.homepageCategoryKeys ?? []).includes(category);
}

function mergeCategoryKeys(keys: string[], category: CategoryKey) {
  return Array.from(new Set([...(keys ?? []), category]));
}

function removeCategoryKey(keys: string[], category: CategoryKey) {
  return (keys ?? []).filter((item) => item !== category);
}

async function setMerchantCategory(item: PlatformMerchantListItem) {
  if (pickerSavingId.value) return;
  pickerSavingId.value = item.id;
  message.value = '';
  try {
    if (activeCategory.value === 'popular') {
      if (!item.manualPopular) {
        await updatePlatformMerchant(item.id, { manualPopular: true });
      }
    } else if (!merchantInCategory(item, activeCategory.value)) {
      await updatePlatformMerchant(item.id, {
        homepageCategoryKeys: mergeCategoryKeys(item.homepageCategoryKeys ?? [], activeCategory.value),
      });
    }
    await loadMerchants();
    message.value = `已加入${activeCategoryMeta.value.title}`;
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    pickerSavingId.value = '';
  }
}

async function removeFromCategory(item: PlatformMerchantListItem) {
  message.value = '';
  try {
    if (activeCategory.value === 'popular') {
      await updatePlatformMerchant(item.id, { manualPopular: false });
    } else {
      await updatePlatformMerchant(item.id, {
        homepageCategoryKeys: removeCategoryKey(item.homepageCategoryKeys ?? [], activeCategory.value),
      });
    }
    await loadMerchants();
    message.value = activeCategory.value === 'popular'
      ? '已取消热门推荐'
      : `已移出${activeCategoryMeta.value.title}`;
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function money(value: string | number) {
  return `${Number(value ?? 0).toLocaleString('en-US')} ₫`;
}

function dateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function regionText(item: PlatformMerchantListItem) {
  return [item.city, item.district].filter(Boolean).join(' / ') || '-';
}

function compareMerchants(left: PlatformMerchantListItem, right: PlatformMerchantListItem) {
  const leftScore = Number(left.todayOrderCount ?? 0);
  const rightScore = Number(right.todayOrderCount ?? 0);
  if (leftScore !== rightScore) return rightScore - leftScore;
  const leftTime = left.lastOrderAt ? new Date(left.lastOrderAt).getTime() : 0;
  const rightTime = right.lastOrderAt ? new Date(right.lastOrderAt).getTime() : 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return String(left.nameZh).localeCompare(String(right.nameZh), 'zh-CN');
}

function categoryTags(item: PlatformMerchantListItem) {
  const tags = (item.homepageCategoryKeys ?? []).map((key) => categoryLabelMap[key as CategoryKey] ?? key);
  if (item.manualPopular) tags.unshift(categoryLabelMap.popular);
  return Array.from(new Set(tags));
}
</script>

<template>
  <section>
    <PageHeader
      title="分类推荐"
      description="集中管理首页热门推荐和商家分类展示"
    >
      <button class="secondary" :disabled="loading" @click="loadMerchants">刷新数据</button>
    </PageHeader>

    <section class="card recommendation-info-card">
      <div class="section-heading">
        <div>
          <h2>首页展示规则</h2>
          <p>仅管理当前系统已支持的热门推荐和三个首页分类。</p>
        </div>
      </div>
      <div class="recommendation-info-grid">
        <div>
          <strong>热门美食</strong>
          <p>由平台手动推荐</p>
        </div>
        <div>
          <strong>中式正餐</strong>
          <p>商家首页分类 chinese</p>
        </div>
        <div>
          <strong>粉面小吃</strong>
          <p>商家首页分类 noodles</p>
        </div>
        <div>
          <strong>茶饮甜品</strong>
          <p>商家首页分类 drinks</p>
        </div>
      </div>
      <p class="hint recommendation-tip">调整后将影响小程序首页商家分类展示。</p>
    </section>

    <section class="platform-recommendation-summary-grid">
      <article class="card platform-metric-card">
        <span>筛选内商家</span>
        <strong>{{ recommendationSummary.merchantCount }}</strong>
        <small>当前查询范围</small>
      </article>
      <article class="card platform-metric-card">
        <span>热门推荐</span>
        <strong>{{ recommendationSummary.recommendedCount }}</strong>
        <small>manualPopular 已开启</small>
      </article>
      <article class="card platform-metric-card">
        <span>已设置分类</span>
        <strong>{{ recommendationSummary.categorizedCount }}</strong>
        <small>至少包含一个首页分类</small>
      </article>
      <article class="card platform-metric-card highlight">
        <span>今日订单金额</span>
        <strong>{{ money(recommendationSummary.todayOrderAmount) }}</strong>
        <small>按筛选内商家汇总</small>
      </article>
    </section>

    <section class="card platform-recommendation-filters">
      <label>
        <span>搜索商家</span>
        <input v-model="draftFilters.keyword" placeholder="输入商家名称 / ID / 手机号" />
      </label>
      <label>
        <span>城市</span>
        <select v-model="draftFilters.city">
          <option value="">全部城市</option>
          <option v-for="city in cityOptions" :key="city" :value="city">{{ city }}</option>
        </select>
      </label>
      <div class="platform-filter-actions recommendation-filter-actions">
        <button class="platform-primary-action" :disabled="loading" @click="applyFilters">查询</button>
        <button class="secondary" :disabled="loading" @click="resetFilters">重置</button>
      </div>
    </section>

    <section class="platform-recommendation-category-grid">
      <article v-for="item in overviewCards" :key="item.key" class="card recommendation-summary-card">
        <span>{{ item.title }}</span>
        <strong>{{ item.merchantCount }}</strong>
        <small>今日订单 {{ item.todayOrderCount }} · {{ money(item.todayOrderAmount) }}</small>
        <small>近 7 日订单 {{ item.last7DaysOrderCount }}</small>
      </article>
    </section>

    <section class="card recommendation-group-card">
      <div class="recommendation-tabs">
        <button
          v-for="item in categories"
          :key="item.key"
          class="recommendation-tab"
          :class="{ active: activeCategory === item.key }"
          @click="activeCategory = item.key"
        >
          {{ item.title }}
          <span>{{ appliedMerchants.filter((merchant) => merchantInCategory(merchant, item.key)).length }}</span>
        </button>
        <button class="secondary recommendation-add-button" @click="openPicker(activeCategory)">
          添加商家
        </button>
      </div>

      <div class="recommendation-group-head">
        <div>
          <h2>{{ activeCategoryMeta.title }}</h2>
          <p>{{ activeCategoryMeta.description }}</p>
        </div>
        <div class="recommendation-group-count">
          当前 {{ activeCategoryMerchants.length }} 家商家
        </div>
      </div>

      <div class="table-wrap recommendation-table-wrap">
        <table class="recommendation-table">
          <thead>
            <tr>
              <th>商家名称</th>
              <th>城市 / 区域</th>
              <th>今日订单</th>
              <th>今日订单金额</th>
              <th>近 7 日订单</th>
              <th>最近订单时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody v-if="loading">
            <tr>
              <td colspan="7" class="empty">加载中...</td>
            </tr>
          </tbody>
          <tbody v-else-if="activeCategoryMerchants.length">
            <tr v-for="item in activeCategoryMerchants" :key="item.id">
              <td>
                <div class="merchant-info-cell recommendation-merchant-cell">
                  <div class="merchant-avatar">{{ item.nameZh.slice(0, 1) }}</div>
                  <div>
                    <strong @click="goMerchantDetail(item.id)">{{ item.nameZh }}</strong>
                    <small>ID: {{ item.id }}</small>
                    <small>{{ item.contactPhone }}</small>
                    <div class="merchant-tag-row">
                      <span
                        v-for="tag in categoryTags(item)"
                        :key="`${item.id}-${tag}`"
                        class="category-tag"
                      >
                        {{ tag }}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td>{{ regionText(item) }}</td>
              <td>{{ item.todayOrderCount }} 单</td>
              <td>{{ money(item.todayOrderAmount) }}</td>
              <td>{{ item.last7DaysOrderCount }} 单</td>
              <td>{{ dateTime(item.lastOrderAt) }}</td>
              <td>
                <div class="actions recommendation-actions">
                  <button class="secondary small" @click="goMerchantDetail(item.id)">查看详情</button>
                  <button
                    v-if="activeCategory === 'popular'"
                    class="warning small"
                    @click="removeFromCategory(item)"
                  >
                    取消热门推荐
                  </button>
                  <button v-else class="danger small" @click="removeFromCategory(item)">
                    移出分类
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr>
              <td colspan="7" class="empty">当前分类暂无商家</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="message" class="message recommendation-message">{{ message }}</div>

    <div v-if="pickerVisible" class="modal-backdrop recommendation-modal-backdrop" @click.self="closePicker">
      <section class="card modal-card recommendation-modal">
        <div class="section-heading recommendation-modal-head">
          <div>
            <h2>添加商家 - {{ activeCategoryMeta.title }}</h2>
            <p>可搜索商家名称 / ID / 手机号，并按城市筛选。</p>
          </div>
          <button class="secondary small" @click="closePicker">关闭</button>
        </div>

        <div class="card recommendation-modal-filters">
          <label>
            <span>搜索商家</span>
            <input v-model="pickerFilters.keyword" placeholder="输入商家名称 / ID / 手机号" />
          </label>
          <label>
            <span>城市</span>
            <select v-model="pickerFilters.city">
              <option value="">全部城市</option>
              <option v-for="city in cityOptions" :key="`picker-${city}`" :value="city">{{ city }}</option>
            </select>
          </label>
          <button class="secondary recommendation-modal-reset" @click="resetPickerFilters">重置</button>
        </div>

        <div class="table-wrap recommendation-picker-table-wrap">
          <table class="recommendation-picker-table">
            <thead>
              <tr>
                <th>商家名称</th>
                <th>城市 / 区域</th>
                <th>当前分类</th>
                <th>今日订单</th>
                <th>今日订单金额</th>
                <th>近 7 日订单</th>
                <th>最近订单时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody v-if="pickerMerchantList.length">
              <tr v-for="item in pickerMerchantList" :key="`picker-${item.id}`">
                <td>
                  <div class="merchant-info-cell recommendation-merchant-cell">
                    <div class="merchant-avatar">{{ item.nameZh.slice(0, 1) }}</div>
                    <div>
                      <strong>{{ item.nameZh }}</strong>
                      <small>ID: {{ item.id }}</small>
                      <small>{{ item.contactPhone }}</small>
                    </div>
                  </div>
                </td>
                <td>{{ regionText(item) }}</td>
                <td>
                  <div class="merchant-tag-row">
                    <span
                      v-for="tag in categoryTags(item)"
                      :key="`${item.id}-picker-${tag}`"
                      class="category-tag"
                    >
                      {{ tag }}
                    </span>
                    <span v-if="!categoryTags(item).length" class="muted-text">未设置</span>
                  </div>
                </td>
                <td>{{ item.todayOrderCount }} 单</td>
                <td>{{ money(item.todayOrderAmount) }}</td>
                <td>{{ item.last7DaysOrderCount }} 单</td>
                <td>{{ dateTime(item.lastOrderAt) }}</td>
                <td>
                  <div class="actions recommendation-actions">
                    <button class="secondary small" @click="goMerchantDetail(item.id)">查看详情</button>
                    <button
                      v-if="activeCategory === 'popular' && item.manualPopular"
                      class="secondary small"
                      disabled
                    >
                      已推荐
                    </button>
                    <button
                      v-else-if="activeCategory !== 'popular' && merchantInCategory(item, activeCategory)"
                      class="secondary small"
                      disabled
                    >
                      已在分类中
                    </button>
                    <button
                      v-else
                      class="platform-primary-action small"
                      :disabled="pickerSavingId === item.id"
                      @click="setMerchantCategory(item)"
                    >
                      {{ activeCategory === 'popular' ? '设为热门推荐' : '添加到本分类' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr>
                <td colspan="8" class="empty">当前分类暂无商家</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </section>
</template>
