<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import PlatformDrawer from "@/components/platform/PlatformDrawer.vue";
import { exploreRequest, getPlatformBusinessTypes } from "@/api/platform";
import { errorMessage } from "@/api/http";
import { resolveMediaUrl } from "@/utils/media";
import { vietnamTime } from "@/utils/platform-format";
const route = useRoute();
type Row = {
  id: string;
  nameZh: string;
  nameVi?: string;
  city: string;
  contactName: string;
  contactPhone: string;
  coverUrl?: string;
  addressZh?: string;
  businessType?: string;
  status: string;
  isVisibleOnClient: boolean;
  claimStatus: string;
  updatedAt: string;
  missing: string[];
};
const key = "yunqiao.platform.directory";
let saved: Record<string, any> = {};
try {
  saved = JSON.parse(sessionStorage.getItem(key) || "{}");
} catch {}
const industryOptions = ref<Array<{ id: string; nameZh: string }>>([]);
const filters = reactive({
  businessTypeId: saved.businessTypeId || "",
  claimStatus: saved.claimStatus || "",
  merchantMode: saved.merchantMode || "",
  popular: saved.popular || "",
  region: saved.region || "",
  district: saved.district || "",
  keyword: saved.keyword || "",
  city: saved.city || "",
  status: saved.status || "",
  view: route.query.incomplete ? "incomplete" : saved.view || "",
  page: saved.page || 1,
  pageSize: 20,
});
const response = ref<{
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
}>();
const applied = ref({ ...filters });
const loading = ref(false);
const message = ref("");
const advanced = ref(false);
const quick = ref<Row>();
const selected = ref<string[]>([]);
const snapshot = ref<{ token: string; total: number }>();
const confirm = ref<"hide" | "trash" | "">("");
const results = ref<Array<{ id: string; ok: boolean; message?: string }>>([]);
const working = ref(false);
let sequence = 0;
function activeFilters(value: typeof filters) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== ""),
  );
}
const pages = computed(() =>
  Math.max(1, Math.ceil((response.value?.total || 0) / filters.pageSize)),
);
const count = computed(() => snapshot.value?.total || selected.value.length);
watch(
  () => [
    filters.keyword,
    filters.city,
    filters.status,
    filters.view,
    filters.businessTypeId,
    filters.claimStatus,
    filters.merchantMode,
    filters.popular,
    filters.region,
    filters.district,
  ],
  () => {
    selected.value = [];
    snapshot.value = undefined;
  },
);
async function load() {
  const id = ++sequence;
  loading.value = true;
  message.value = "";
  const q = { ...filters };
  try {
    const data = await exploreRequest<typeof response.value>(
      "get",
      `/platform/workbench/directory?${new URLSearchParams(Object.entries(activeFilters(q)).map(([k, v]) => [k, String(v)]))}`,
    );
    if (id !== sequence) return;
    response.value = data;
    applied.value = q;
    sessionStorage.setItem(key, JSON.stringify(q));
    selected.value = [];
    snapshot.value = undefined;
    if (route.query.quick) {
      quick.value = await exploreRequest<Row>(
        "get",
        `/platform/workbench/merchants/${route.query.quick}/quick`,
      );
    }
  } catch (e) {
    if (id === sequence) message.value = errorMessage(e);
  } finally {
    if (id === sequence) loading.value = false;
  }
}
async function exportRows() {
  working.value = true;
  try {
    const query = new URLSearchParams(
      Object.entries(activeFilters(applied.value)).map(([k, v]) => [k, String(v)]),
    );
    const file = await exploreRequest<{ filename: string; content: string }>(
      "get",
      `/platform/workbench/directory-export?${query}`,
    );
    const url = URL.createObjectURL(
      new Blob([file.content], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    working.value = false;
  }
}
function search() {
  filters.page = 1;
  void load();
}
function allPage(event: Event) {
  snapshot.value = undefined;
  selected.value = (event.target as HTMLInputElement).checked
    ? response.value?.items.map((m) => m.id) || []
    : [];
}
async function allMatching() {
  working.value = true;
  try {
    snapshot.value = await exploreRequest(
      "post",
      "/platform/workbench/selection",
      activeFilters(applied.value),
    );
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    working.value = false;
  }
}
async function bulk(retry = false) {
  working.value = true;
  message.value = "";
  try {
    const body = retry
      ? {
          ids: results.value.filter((r) => !r.ok).map((r) => r.id),
          action: confirm.value,
        }
      : {
          ...(snapshot.value
            ? { token: snapshot.value.token }
            : { ids: [...selected.value] }),
          action: confirm.value,
        };
    const data = await exploreRequest<{ results: typeof results.value }>(
      "post",
      "/platform/workbench/bulk",
      body,
    );
    results.value = data.results;
    selected.value = [];
    snapshot.value = undefined;
    await load();
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    working.value = false;
  }
}
watch(
  () => route.query.quick,
  () => {
    void load();
  },
);
onBeforeRouteLeave(() => {
  sessionStorage.setItem(`${key}.scroll`, String(window.scrollY));
});
onMounted(async () => {
  industryOptions.value = await getPlatformBusinessTypes().catch(() => []);
  await load();
  const top = Number(sessionStorage.getItem(`${key}.scroll`) || 0);
  requestAnimationFrame(() => window.scrollTo({ top, behavior: "auto" }));
});
</script>
<template>
  <section>
    <PageHeader
      :title="$pt('商家列表')"
      :description="$pt('维护商家资料、展示状态与经营能力。')"
      ><div class="p-inline">
        <button
          class="secondary"
          :disabled="working || !response"
          @click="exportRows"
        >
          {{ $pt("导出筛选结果") }}
        </button>
        <RouterLink
          class="button-link secondary"
          to="/platform/merchants/trash"
          >{{ $pt("回收站") }}</RouterLink
        ><RouterLink
          class="button-link secondary"
          to="/platform/merchants/import"
          >{{ $pt("批量导入") }}</RouterLink
        ><RouterLink class="button-link" to="/platform/merchants/new">{{
          $pt("＋ 新增商家")
        }}</RouterLink>
      </div></PageHeader
    >
    <form class="card p-inline" @submit.prevent="search">
      <input
        v-model="filters.keyword"
        :placeholder="$pt('搜索店名、越南文名称或电话')"
        :aria-label="$pt('搜索商家')"
        style="min-width: 280px"
      /><select v-model="filters.view" :aria-label="$pt('展示状态')">
        <option value="">{{ $pt("全部状态") }}</option>
        <option value="visible">{{ $pt("对外展示") }}</option>
        <option value="hidden">{{ $pt("隐藏 / 草稿") }}</option>
        <option value="incomplete">{{ $pt("待完善资料") }}</option>
        <option value="complete">{{ $pt("资料齐全") }}</option>
        <option value="missing_coords">{{ $pt("缺少定位") }}</option>
        <option value="missing_images">{{ $pt("缺少封面") }}</option></select
      ><button :disabled="loading">{{ $pt("查询") }}</button
      ><button class="text-button" type="button" @click="advanced = !advanced">
        {{ $pt("高级筛选") }}{{ advanced ? "−" : "＋" }}</button
      ><template v-if="advanced">
        <select v-model="filters.businessTypeId" :aria-label="$pt('经营行业')">
          <option value="">{{ $pt("全部行业") }}</option>
          <option
            v-for="industry in industryOptions"
            :key="industry.id"
            :value="industry.id"
          >
            {{ industry.nameZh }}
          </option>
        </select>
        <select v-model="filters.claimStatus" :aria-label="$pt('认领状态')">
          <option value="">{{ $pt("全部认领状态") }}</option>
          <option value="CLAIMED">{{ $pt("已认领") }}</option>
          <option value="UNCLAIMED">{{ $pt("未认领") }}</option>
        </select>
        <select v-model="filters.merchantMode" :aria-label="$pt('商家模式')">
          <option value="">{{ $pt("全部商家模式") }}</option>
          <option value="DISPLAY">{{ $pt("展示模式") }}</option>
          <option value="MANAGED">{{ $pt("经营模式") }}</option>
        </select>
        <select v-model="filters.popular" :aria-label="$pt('人工推荐')">
          <option value="">{{ $pt("全部推荐状态") }}</option>
          <option value="yes">{{ $pt("已推荐") }}</option>
          <option value="no">{{ $pt("未推荐") }}</option>
        </select>
        <input v-model="filters.region" :placeholder="$pt('运营区域')" /><input
          v-model="filters.district"
          :placeholder="$pt('区县')"
        />
        <input
          v-model="filters.city"
          :placeholder="$pt('城市')"
          :aria-label="$pt('城市')"
        /><select v-model="filters.status" :aria-label="$pt('商家状态')">
          <option value="">{{ $pt("全部经营状态") }}</option>
          <option value="ACTIVE">{{ $pt("正常") }}</option>
          <option value="PENDING">{{ $pt("草稿 / 待完善") }}</option>
          <option value="DISABLED">{{ $pt("已停用") }}</option>
        </select></template
      >
    </form>
    <p v-if="message" class="error" role="alert">
      {{ $pt(message) }}{{ response ? $pt("。下方保留上次成功结果。") : "" }}
    </p>
    <div v-if="count" class="p-selection">
      <span
        >{{ $pt("已选择") }}{{ count }}{{ $pt("家商家")
        }}{{ snapshot ? $pt("（已固定全部筛选结果）") : $pt("（本页）") }}</span
      ><button
        v-if="!snapshot && response && response.total > selected.length"
        class="text-button"
        :disabled="working"
        @click="allMatching"
      >
        {{ $pt("选择全部") }}{{ response.total }}{{ $pt("条筛选结果") }}</button
      ><button
        class="secondary small"
        @click="
          confirm = 'hide';
          results = [];
        "
      >
        {{ $pt("批量隐藏") }}</button
      ><button
        class="secondary small"
        @click="
          confirm = 'trash';
          results = [];
        "
      >
        {{ $pt("移入回收站") }}</button
      ><button
        class="text-button"
        @click="
          selected = [];
          snapshot = undefined;
        "
      >
        {{ $pt("取消选择") }}
      </button>
    </div>
    <article class="card" style="padding: 0; overflow: hidden">
      <div class="p-directory-heading">
        <h2>
          {{ $pt("全部商家") }}<small>{{ response?.total ?? "—" }}</small>
        </h2>
        <span class="p-muted">{{
          loading ? $pt("正在更新…") : `第 ${response?.page || 1} 页`
        }}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  :aria-label="$pt('选择本页')"
                  :checked="
                    !!response?.items.length &&
                    selected.length === response.items.length
                  "
                  @change="allPage"
                />
              </th>
              <th>{{ $pt("商家") }}</th>
              <th>{{ $pt("城市 / 行业") }}</th>
              <th>{{ $pt("联系人") }}</th>
              <th>{{ $pt("展示状态") }}</th>
              <th>{{ $pt("资料状态") }}</th>
              <th>{{ $pt("最近更新") }}</th>
              <th>{{ $pt("操作") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in response?.items" :key="row.id">
              <td>
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="row.id"
                  :aria-label="`选择${row.nameZh}`"
                  @change="snapshot = undefined"
                />
              </td>
              <td>
                <button class="p-merchant-cell" @click="quick = row">
                  <img
                    v-if="row.coverUrl"
                    :src="resolveMediaUrl(row.coverUrl)"
                    alt=""
                    loading="lazy"
                  /><span v-else class="p-avatar">{{
                    row.nameZh.charAt(0)
                  }}</span
                  ><span
                    ><strong>{{ row.nameZh }}</strong
                    ><small>{{ row.nameVi || `编号 ${row.id}` }}</small></span
                  >
                </button>
              </td>
              <td>
                {{ row.city
                }}<small class="p-cell-sub">{{
                  row.businessType || $pt("未设置行业")
                }}</small>
              </td>
              <td>
                {{ row.contactName || $pt("待补充")
                }}<small class="p-cell-sub">{{
                  row.contactPhone || "—"
                }}</small>
              </td>
              <td>
                <span
                  class="badge"
                  :class="row.isVisibleOnClient ? 'success' : 'muted'"
                  >{{
                    row.isVisibleOnClient
                      ? $pt("展示中")
                      : row.status === "PENDING"
                        ? $pt("草稿")
                        : $pt("已隐藏")
                  }}</span
                >
              </td>
              <td>
                <span
                  class="badge"
                  :class="row.missing.length ? 'warning' : 'muted'"
                  >{{
                    row.missing.length
                      ? `待完善 ${row.missing.length} 项`
                      : $pt("资料齐全")
                  }}</span
                >
              </td>
              <td>{{ vietnamTime(row.updatedAt) }}</td>
              <td>
                <div class="p-inline">
                  <button class="p-table-action" @click="quick = row">
                    {{ $pt("快览") }}</button
                  ><RouterLink :to="`/platform/merchants/${row.id}`">{{
                    $pt("编辑")
                  }}</RouterLink>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && !response?.items.length" class="empty-state">
        {{ $pt("当前条件下没有商家，试试调整筛选或新增商家。") }}
      </p>
      <div class="p-pagination">
        <span
          >{{ $pt("共") }}{{ response?.total ?? "—"
          }}{{ $pt("家 · 每页 20 家") }}</span
        ><button
          class="secondary small"
          :disabled="loading || filters.page <= 1"
          @click="
            filters.page--;
            load();
          "
        >
          {{ $pt("上一页") }}</button
        ><span>{{ filters.page }} / {{ pages }}</span
        ><button
          class="secondary small"
          :disabled="loading || filters.page >= pages"
          @click="
            filters.page++;
            load();
          "
        >
          {{ $pt("下一页") }}
        </button>
      </div>
    </article>
    <PlatformDrawer
      :open="!!quick"
      :title="quick?.nameZh || '商家快览'"
      @close="quick = undefined"
      ><template v-if="quick"
        ><img
          v-if="quick.coverUrl"
          class="p-quick-cover"
          :src="resolveMediaUrl(quick.coverUrl)"
          :alt="quick.nameZh"
        />
        <dl class="detail-list">
          <dt>{{ $pt("越南文名称") }}</dt>
          <dd>{{ quick.nameVi || $pt("待补充") }}</dd>
          <dt>{{ $pt("城市 / 行业") }}</dt>
          <dd>{{ quick.city }} · {{ quick.businessType || $pt("未设置") }}</dd>
          <dt>{{ $pt("联系人") }}</dt>
          <dd>
            {{ quick.contactName || $pt("待补充") }} ·
            {{ quick.contactPhone || "—" }}
          </dd>
          <dt>{{ $pt("地址") }}</dt>
          <dd>{{ quick.addressZh || $pt("待补充") }}</dd>
          <dt>{{ $pt("展示状态") }}</dt>
          <dd>
            {{ quick.isVisibleOnClient ? $pt("对外展示中") : $pt("未展示") }}
          </dd>
        </dl>
        <h3>{{ $pt("资料检查") }}</h3>
        <ul>
          <li v-for="field in quick.missing" :key="field">
            {{ $pt("待完善：") }}{{ $pt(field) }}
          </li>
        </ul>
        <p v-if="!quick.missing.length">{{ $pt("当前资料齐全") }}</p></template
      ><template #footer
        ><RouterLink
          v-if="quick"
          class="p-drawer-edit"
          :to="`/platform/merchants/${quick.id}`"
          >{{ $pt("进入完整编辑 →") }}</RouterLink
        ></template
      ></PlatformDrawer
    >
    <PlatformDrawer
      :open="!!confirm"
      :title="confirm === 'hide' ? '批量隐藏商家' : '移入回收站'"
      @close="confirm = ''"
    >
      <p>
        {{
          confirm === "hide"
            ? $pt("隐藏后将停止对外展示，商家资料和账号保留。")
            : $pt("移入回收站后停止展示并停用商家账号，可在回收站恢复。")
        }}
      </p>
      <p v-if="!results.length">
        {{ $pt("本次操作已固定选择范围，共") }}{{ count }}{{ $pt("家商家。") }}
      </p>
      <p v-else>
        {{ $pt("成功") }}{{ results.filter((r) => r.ok).length
        }}{{ $pt("家，失败") }}{{ results.filter((r) => !r.ok).length
        }}{{ $pt("家。") }}
      </p>
      <ul>
        <li v-for="r in results.filter((r) => !r.ok)" :key="r.id">
          {{ $pt("商家") }}{{ r.id }}：{{ r.message }}
        </li>
      </ul>
      <template #footer
        ><button
          v-if="!results.length"
          :disabled="working || !count"
          @click="bulk()"
        >
          {{ working ? $pt("正在处理…") : $pt("确认执行") }}</button
        ><button
          v-else-if="results.some((r) => !r.ok)"
          :disabled="working"
          @click="bulk(true)"
        >
          {{ $pt("仅重试失败项") }}</button
        ><button v-else @click="confirm = ''">
          {{ $pt("完成") }}
        </button></template
      ></PlatformDrawer
    >
  </section>
</template>
