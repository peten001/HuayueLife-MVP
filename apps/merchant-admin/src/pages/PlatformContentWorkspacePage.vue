<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import PlatformDrawer from "@/components/platform/PlatformDrawer.vue";
import {
  exploreRequest,
  getPlatformBusinessTypes,
  uploadPlatformMerchantImage,
} from "@/api/platform";
import { errorMessage } from "@/api/http";
import type { ExploreCategory, ExploreTopic } from "@/api/explore";
import type { PlatformPromotionTag, PlatformBusinessType } from "@/types/api";
import { merchantCategoryOptions } from "@/utils/merchant-categories";
import { resolveMediaUrl } from "@/utils/media";
import { vietnamDate, vietnamTime } from "@/utils/platform-format";
const route = useRoute();
const router = useRouter();
type Rec = {
  merchantId: string;
  manualPopular: boolean;
  homepageCategoryKeys: string[];
};
type Merchant = {
  id: string;
  nameZh: string;
  nameVi?: string;
  city: string;
  coverUrl?: string;
  isVisibleOnClient: boolean;
  status: string;
  businessType?: { code: string };
};
type Content = {
  categories: ExploreCategory[];
  topics: ExploreTopic[];
  tags: PlatformPromotionTag[];
  recommendations: Rec[];
  version: number;
  baseRevision: string;
  hasDraft?: boolean;
  savedAt?: string;
  conflicted?: boolean;
  current?: Content;
  merchants: Merchant[];
};
const content = ref<Content>();
const types = ref<PlatformBusinessType[]>([]);
const loading = ref(false);
const busy = ref(false);
const message = ref("");
const initial = ref("");
const keyword = ref("");
const city = ref("");
const scope = ref("");
const kind = computed(() =>
  route.path.startsWith("/platform/promotion-tags")
    ? "tags"
    : route.path.startsWith("/platform/recommendations")
      ? "recommendations"
      : "categories",
);
const editorKind = computed(() =>
  kind.value === "tags"
    ? "tags"
    : route.params.kind === "topics"
      ? "topics"
      : "categories",
);
const editing = computed(() => !!route.params.id);
const form = ref<Record<string, any>>();
const formInitial = ref("");
const quick = ref<PlatformPromotionTag>();
const impact = ref<{
  total: number;
  items: Array<{ id: string; nameZh: string; city: string }>;
}>();
const previewOpen = ref(false);
const preview = ref<any>();
const previewCity = ref("北宁");
const previewAt = ref(`${vietnamDate()}T12:00`);
const previewToken = ref("");
const dirty = computed(
  () =>
    !!content.value &&
    (JSON.stringify(payload()) !== initial.value ||
      (editing.value &&
        !!form.value &&
        JSON.stringify(form.value) !== formInitial.value)),
);
const title = computed(() =>
  editing.value
    ? (route.params.id === "new" ? "新增" : "编辑") +
      (editorKind.value === "tags"
        ? "标签"
        : editorKind.value === "topics"
          ? "场景专题"
          : "生活分类")
    : kind.value === "tags"
      ? "标签库"
      : kind.value === "recommendations"
        ? "首页推荐"
        : "生活分类",
);
const back = computed(() =>
  kind.value === "tags" ? "/platform/promotion-tags" : "/platform/explore",
);
const legacy = merchantCategoryOptions().filter(item=>item.value!=='popular_food');
const filteredTags = computed(
  () =>
    content.value?.tags.filter(
      (tag) =>
        (!scope.value || tag.scope === scope.value) &&
        (!keyword.value ||
          [tag.nameZh, tag.nameVi, tag.code].some((v) =>
            v?.toLowerCase().includes(keyword.value.toLowerCase()),
          )),
    ) || [],
);
const filteredMerchants = computed(
  () =>
    content.value?.merchants.filter(
      (m) =>
        (!city.value || m.city === city.value) &&
        (!keyword.value ||
          [m.nameZh, m.nameVi].some((v) =>
            v?.toLowerCase().includes(keyword.value.toLowerCase()),
          )),
    ) || [],
);
function resetToCurrent() {
  if (!content.value?.current) return;
  if (!window.confirm("使用最新已发布配置重建草稿？当前待发布修改将被替换。"))
    return;
  const version = content.value.version;
  const merchants = content.value.merchants;
  content.value = {
    ...content.value.current,
    version,
    merchants,
    conflicted: false,
  };
  message.value = "已载入最新已发布配置，请重新调整并保存草稿。";
}
function payload() {
  if (!content.value) return {};
  const { categories, topics, tags, recommendations, version, baseRevision } =
    content.value;
  return { categories, topics, tags, recommendations, version, baseRevision };
}
async function load() {
  loading.value = true;
  message.value = "";
  try {
    const [data, businessTypes] = await Promise.all([
      exploreRequest<Content>("get", "/platform/content/draft"),
      getPlatformBusinessTypes(),
    ]);
    content.value = data;
    types.value = businessTypes;
    initial.value = JSON.stringify(payload());
    if (editing.value) {
      setupForm();
      formInitial.value = JSON.stringify(form.value);
    }
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
function setupForm() {
  if (!content.value) return;
  const id = String(route.params.id);
  if (id !== "new") {
    const found =
      editorKind.value === "tags"
        ? content.value.tags.find((t) => t.id === id)
        : content.value[
            editorKind.value === "topics" ? "topics" : "categories"
          ].find((c) => c.code === id);
    if (!found) {
      message.value = "未找到该内容，请返回列表核对";
      return;
    }
    form.value = JSON.parse(JSON.stringify(found));
    return;
  }
  if (editorKind.value === "tags")
    form.value = {
      id: `new-${crypto.randomUUID()}`,
      code: `TAG_${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`,
      nameZh: "",
      nameVi: "",
      nameEn: "",
      scope: "SCENE",
      sortOrder: 0,
      enabled: true,
      color: "#416bd8",
      description: "",
      merchantReferenceCount: 0,
    };
  else if (editorKind.value === "topics")
    form.value = {
      code: `topic-${crypto.randomUUID().slice(0, 8)}`,
      nameZh: "",
      nameVi: "",
      nameEn: "",
      subtitleZh: "",
      subtitleVi: "",
      subtitleEn: "",
      imageUrl: "",
      regions: [],
      categoryCode: "",
      promotionTagCode: "",
      sortOrder: 0,
      enabled: false,
    };
  else
    form.value = {
      code: `category-${crypto.randomUUID().slice(0, 8)}`,
      nameZh: "",
      nameVi: "",
      nameEn: "",
      iconKey: "food",
      businessTypeCodes: [],
      legacyKeys: [],
      sortOrder: 0,
      enabled: true,
    };
}
function applyForm() {
  if (!content.value || !form.value) return;
  const rows = content.value[editorKind.value] as Array<any>;
  const field = editorKind.value === "tags" ? "id" : "code";
  const original = String(route.params.id);
  const index =
    original === "new"
      ? -1
      : rows.findIndex((item) => String(item[field]) === original);
  if (index < 0) {
    if (rows.some((item) => item[field] === form.value?.[field]))
      throw new Error("编码重复，请调整后重试");
    rows.push({ ...form.value });
  } else rows[index] = { ...form.value };
}
async function saveForm() {
  const before = content.value
    ? JSON.parse(JSON.stringify(content.value))
    : undefined;
  try {
    applyForm();
    if (!(await save())) {
      content.value = before;
      return;
    }
    formInitial.value = JSON.stringify(form.value);
    await router.push(back.value);
  } catch (e) {
    content.value = before;
    message.value = errorMessage(e);
  }
}
async function save() {
  if (!content.value) return;
  busy.value = true;
  message.value = "";
  try {
    const result = await exploreRequest<Partial<Content>>(
      "put",
      "/platform/content/draft",
      payload(),
    );
    Object.assign(content.value, result);
    initial.value = JSON.stringify(payload());
    preview.value = undefined;
    previewToken.value = "";
    message.value = "草稿已保存，预览并统一发布后对外生效。";
    return true;
  } catch (e) {
    message.value = errorMessage(e);
    return false;
  } finally {
    busy.value = false;
  }
}
async function openTag(tag: PlatformPromotionTag) {
  quick.value = tag;
  impact.value = undefined;
  if (!/^\d+$/.test(tag.id)) return;
  try {
    impact.value = await exploreRequest(
      "get",
      `/platform/workbench/tags/${tag.id}/impact`,
    );
  } catch (e) {
    message.value = errorMessage(e);
  }
}
function rec(id: string) {
  return content.value!.recommendations.find((r) => r.merchantId === id)!;
}
async function showPreview() {
  if (!content.value) return;
  busy.value = true;
  message.value = "";
  try {
    preview.value = await exploreRequest("post", "/platform/content/preview", {
      draft: payload(),
      city: previewCity.value,
      at: new Date(`${previewAt.value}:00+07:00`).toISOString(),
    });
    previewToken.value = preview.value.previewToken || "";
    previewOpen.value = true;
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function publish() {
  if (!preview.value || !content.value) return;
  busy.value = true;
  message.value = "";
  try {
    await exploreRequest("post", "/platform/content/publish", {
      ...payload(),
      previewToken: previewToken.value,
    });
    previewOpen.value = false;
    await load();
    message.value = "已统一发布，分类、专题、标签文案和推荐同步生效。";
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function removeTopic() {
  if (
    !content.value ||
    !form.value ||
    !window.confirm(
      `将“${form.value.nameZh}”从专题草稿中移除？统一发布前，现有内容仍会展示。`,
    )
  )
    return;
  const before = content.value.topics;
  content.value.topics = before.filter(
    (topic) => topic.code !== route.params.id,
  );
  if (await save()) {
    formInitial.value = JSON.stringify(form.value);
    await router.push(back.value);
  } else content.value.topics = before;
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file || !form.value) return;
  busy.value = true;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error("单张图片不能超过 20MB");
    form.value.imageUrl = (await uploadPlatformMerchantImage(file)).imageUrl;
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
onBeforeRouteLeave(() => {
  if (dirty.value) return window.confirm("内容还有未保存的草稿，是否离开？");
  return true;
});
onMounted(load);
</script>
<template>
  <section>
    <PageHeader
      :title="title"
      :description="
        editing
          ? '修改先进入草稿，预览并统一发布后才对外生效。'
          : kind === 'tags'
            ? '统一维护公共标签，修改名称会同步到所有关联商家。'
            : kind === 'recommendations'
              ? '保留现有自动推荐规则，人工推荐与分类调整统一预览发布。'
              : '统一管理生活入口和场景专题。'
      "
      ><div class="p-inline">
        <RouterLink v-if="editing" class="button-link secondary" :to="back">{{
          $pt("返回列表")
        }}</RouterLink
        ><template v-else
          ><button class="secondary" :disabled="busy || loading" @click="load">
            {{ $pt("刷新") }}</button
          ><RouterLink
            v-if="kind === 'tags'"
            class="button-link"
            to="/platform/promotion-tags/new"
            >{{ $pt("＋ 新增标签") }}</RouterLink
          ><RouterLink
            v-if="kind === 'categories'"
            class="button-link"
            to="/platform/explore/categories/new"
            >{{ $pt("＋ 新增分类") }}</RouterLink
          ></template
        >
      </div></PageHeader
    >
    <p v-if="message" class="p-status-note" role="status">{{ $pt(message) }}</p>
    <p v-if="loading" role="status">{{ $pt("正在读取内容配置…") }}</p>
    <template v-if="content"
      ><p v-if="content.conflicted" class="error">
        {{ $pt("正式配置已有更新，请重新加载核对草稿，避免覆盖其他操作。")
        }}<button class="secondary small" @click="resetToCurrent">
          {{ $pt("使用最新配置重建草稿") }}
        </button>
      </p>
      <p v-else class="p-summary-note">
        {{
          content.hasDraft || content.savedAt
            ? $pt("当前有待发布草稿")
            : $pt("正在查看已发布配置")
        }}{{ content.savedAt ? ` · ${vietnamTime(content.savedAt)}` : ""
        }}{{ $pt("。当前操作不会立即改变用户看到的内容。") }}
      </p>
      <form v-if="editing && form" @submit.prevent="saveForm">
        <article class="card">
          <h2>
            {{
              editorKind === "tags"
                ? $pt("标签内容")
                : editorKind === "topics"
                  ? $pt("场景专题")
                  : $pt("分类内容")
            }}
          </h2>
          <div class="p-form-grid">
            <label
              >{{ editorKind === "tags" ? $pt("标签编码") : $pt("内容编码")
              }}<input
                v-model="form.code"
                required
                maxlength="64"
                :readonly="route.params.id !== 'new'"
                :placeholder="
                  editorKind === 'tags'
                    ? '例如 FAMILY_FRIENDLY'
                    : '例如 after-work'
                " /></label
            ><label v-if="editorKind === 'tags'"
              >{{ $pt("用途")
              }}<select
                v-model="form.scope"
                :disabled="route.params.id !== 'new'"
              >
                <option value="OPERATIONAL">{{ $pt("平台运营") }}</option>
                <option value="CUISINE">{{ $pt("菜系") }}</option>
                <option value="SCENE">{{ $pt("场景") }}</option>
              </select></label
            ><label
              v-for="language in [
                { key: 'Zh', label: '中文名称' },
                { key: 'Vi', label: '越南文名称' },
                { key: 'En', label: '英文名称（选填）' },
              ]"
              :key="language.key"
              >{{ $pt(language.label)
              }}<input
                v-model="form[`name${language.key}`]"
                :required="language.key === 'Zh'"
                maxlength="80" /></label
            ><label
              >{{ $pt("排序")
              }}<input
                v-model.number="form.sortOrder"
                type="number"
                min="0"
                max="9999"
                :disabled="form.reserved" /></label
            ><label v-if="editorKind === 'tags'"
              >{{ $pt("标签色")
              }}<select v-model="form.color">
                <option value="#416bd8">{{ $pt("蓝色") }}</option>
                <option value="#7961c8">{{ $pt("紫色") }}</option>
                <option value="#288f95">{{ $pt("青色") }}</option>
                <option value="#707a8b">{{ $pt("灰色") }}</option>
              </select></label
            ><label v-if="editorKind === 'tags'" class="full"
              >{{ $pt("说明")
              }}<textarea v-model="form.description" maxlength="255" /></label
            ><label class="p-inline"
              ><input
                v-model="form.enabled"
                type="checkbox"
                :disabled="form.reserved"
              />{{ $pt("启用")
              }}{{ editorKind === "tags" ? $pt("标签") : $pt("内容") }}</label
            >
          </div>
          <template v-if="editorKind === 'categories'"
            ><h2 style="margin-top: 28px">{{ $pt("关联行业") }}</h2>
            <div class="p-inline">
              <label
                v-for="type in types.filter((t) => t.enabled)"
                :key="type.id"
                class="p-tag-check"
                ><input
                  v-model="form.businessTypeCodes"
                  type="checkbox"
                  :value="type.code"
                />{{ type.nameZh }}</label
              >
            </div>
            <h2 style="margin-top: 28px">{{ $pt("兼容现有分类") }}</h2>
            <div class="p-inline">
              <label
                v-for="item in legacy"
                :key="item.value"
                class="p-tag-check"
                ><input
                  v-model="form.legacyKeys"
                  type="checkbox"
                  :value="item.value"
                />{{ $pt(item.label) }}</label
              >
            </div>
            <label style="display: grid; gap: 8px; margin-top: 24px"
              >{{ $pt("图标")
              }}<select v-model="form.iconKey">
                <option
                  v-for="icon in [
                    'food',
                    'coffee',
                    'massage',
                    'hotel',
                    'ktv',
                    'beauty',
                    'shop',
                    'fresh',
                    'sport',
                    'all',
                    'chinese',
                    'noodles',
                    'vietnamese',
                    'flowers',
                    'fruit',
                    'japanese',
                    'thai',
                    'seafood',
                    'korean',
                    'western',
                    'hotpot',
                    'barbecue',
                    'buffet',
                    'bakery',
                    'fastfood',
                    'vegetarian',
                  ]"
                  :key="icon"
                >
                  {{ icon }}
                </option>
              </select></label
            ></template
          >
          <template v-if="editorKind === 'topics'"
            ><h2 style="margin-top: 28px">{{ $pt("封面与展示范围") }}</h2>
            <img
              v-if="form.imageUrl"
              class="p-topic-cover"
              :src="resolveMediaUrl(form.imageUrl)"
              :alt="$pt('专题封面')"
            /><input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              @change="upload"
            />
            <div class="p-form-grid" style="margin-top: 24px">
              <label
                >{{ $pt("中文副标题")
                }}<input v-model="form.subtitleZh" maxlength="120" /></label
              ><label
                >{{ $pt("越南文副标题")
                }}<input v-model="form.subtitleVi" maxlength="120" /></label
              ><label
                >{{ $pt("关联分类")
                }}<select v-model="form.categoryCode">
                  <option value="">{{ $pt("无") }}</option>
                  <option
                    v-for="category in content.categories.filter(
                      (c) => c.enabled && !c.navigationOnly,
                    )"
                    :key="category.code"
                    :value="category.code"
                  >
                    {{ category.nameZh }}
                  </option>
                </select></label
              ><label
                >{{ $pt("关联标签")
                }}<select v-model="form.promotionTagCode">
                  <option value="">{{ $pt("无") }}</option>
                  <option
                    v-for="tag in content.tags.filter(
                      (t) => t.enabled && t.scope !== 'CUISINE',
                    )"
                    :key="tag.id"
                    :value="tag.code"
                  >
                    {{ tag.nameZh }}
                  </option>
                </select></label
              >
            </div>
            <div class="p-inline" style="margin-top: 24px">
              <span class="p-muted">{{ $pt("展示城市（不选表示全部）") }}</span
              ><label
                v-for="region in ['北江', '北宁']"
                :key="region"
                class="p-tag-check"
                ><input
                  v-model="form.regions"
                  type="checkbox"
                  :value="region"
                />{{ region }}</label
              >
            </div></template
          >
          <p v-if="editorKind === 'tags'" class="p-status-note">
            {{ $pt("发布后将同步更新") }}{{ form.merchantReferenceCount || 0
            }}{{
              $pt(
                "家关联商家。标签编码和已有商家关联保持不变。停用后不再公开展示，保留关联以便恢复。",
              )
            }}
          </p>
        </article>
        <div class="p-sticky-actions">
          <span>{{ $pt("修改先保存为草稿") }}</span>
          <button
            v-if="editorKind === 'topics' && route.params.id !== 'new'"
            class="secondary"
            type="button"
            :disabled="busy"
            @click="removeTopic"
          >
            {{ $pt("从草稿移除专题") }}
          </button>
          <button :disabled="busy || content.conflicted">
            {{ busy ? $pt("正在保存…") : $pt("保存草稿并返回") }}
          </button>
        </div>
      </form>
      <template v-else>
        <article v-if="kind === 'tags'" class="card">
          <form class="p-inline" style="margin-bottom: 24px" @submit.prevent>
            <input
              v-model="keyword"
              :placeholder="$pt('搜索标签名称或编码')"
            /><select v-model="scope" :aria-label="$pt('标签用途')">
              <option value="">{{ $pt("全部用途") }}</option>
              <option value="OPERATIONAL">{{ $pt("平台运营") }}</option>
              <option value="CUISINE">{{ $pt("菜系") }}</option>
              <option value="SCENE">{{ $pt("场景") }}</option></select
            ><span class="p-muted"
              >{{ filteredTags.length }}{{ $pt("个标签 · 不限选择数量") }}</span
            >
          </form>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ $pt("标签") }}</th>
                  <th>{{ $pt("用途") }}</th>
                  <th>{{ $pt("关联商家") }}</th>
                  <th>{{ $pt("状态") }}</th>
                  <th>{{ $pt("操作") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tag in filteredTags" :key="tag.id">
                  <td>
                    <span
                      class="p-tag-dot"
                      :style="{ background: tag.color || '#707a8b' }"
                    /><strong>{{ tag.nameZh }}</strong
                    ><small class="p-cell-sub">{{
                      tag.nameVi || tag.code
                    }}</small>
                  </td>
                  <td>
                    {{
                      tag.scope === "CUISINE"
                        ? $pt("菜系")
                        : tag.scope === "SCENE"
                          ? $pt("场景")
                          : $pt("平台运营")
                    }}
                  </td>
                  <td>{{ tag.merchantReferenceCount || 0 }}{{ $pt("家") }}</td>
                  <td>
                    <span
                      class="badge"
                      :class="tag.enabled ? 'success' : 'muted'"
                      >{{ tag.enabled ? $pt("启用") : $pt("停用") }}</span
                    >
                  </td>
                  <td>
                    <div class="p-inline">
                      <button class="p-table-action" @click="openTag(tag)">
                        {{ $pt("快览") }}</button
                      ><RouterLink :to="`/platform/promotion-tags/${tag.id}`">{{
                        $pt("编辑")
                      }}</RouterLink>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
        <template v-if="kind === 'categories'"
          ><article class="card">
            <div class="section-heading">
              <h2>{{ $pt("生活分类") }}</h2>
              <span class="p-muted"
                >{{ content.categories.length }}{{ $pt("个入口") }}</span
              >
            </div>
            <div class="p-content-grid">
              <article
                v-for="category in content.categories"
                :key="category.code"
                class="p-content-tile"
              >
                <div class="p-inline">
                  <h3>{{ category.nameZh }}</h3>
                  <span
                    class="badge"
                    :class="category.enabled ? 'success' : 'muted'"
                    >{{ category.enabled ? $pt("启用") : $pt("隐藏") }}</span
                  >
                </div>
                <p>{{ category.nameVi || $pt("越南文待完善") }}</p>
                <small
                  >{{ category.businessTypeCodes.length
                  }}{{ $pt("个关联行业 · 排序")
                  }}{{ category.sortOrder }}</small
                ><RouterLink
                  :to="`/platform/explore/categories/${category.code}`"
                  >{{ $pt("编辑分类 →") }}</RouterLink
                >
              </article>
            </div>
          </article>
          <article class="card">
            <div class="section-heading">
              <h2>{{ $pt("场景专题") }}</h2>
              <RouterLink to="/platform/explore/topics/new">{{
                $pt("＋ 新增专题")
              }}</RouterLink>
            </div>
            <div class="p-content-grid">
              <article
                v-for="topic in content.topics"
                :key="topic.code"
                class="p-content-tile"
              >
                <img
                  v-if="topic.imageUrl"
                  class="p-topic-cover"
                  :src="resolveMediaUrl(topic.imageUrl)"
                  :alt="topic.nameZh"
                />
                <h3>{{ topic.nameZh }}</h3>
                <p>{{ topic.subtitleZh || $pt("尚未设置副标题") }}</p>
                <small
                  >{{ topic.regions.join(" / ") || $pt("全部城市") }} ·
                  {{ topic.enabled ? $pt("启用") : $pt("隐藏") }}</small
                ><RouterLink :to="`/platform/explore/topics/${topic.code}`">{{
                  $pt("编辑专题 →")
                }}</RouterLink>
              </article>
            </div>
            <p v-if="!content.topics.length" class="empty-state">
              {{ $pt("还没有场景专题") }}
            </p>
          </article></template
        >
        <template v-if="kind === 'recommendations'"
          ><article class="card">
            <h2>{{ $pt("自动推荐") }}</h2>
            <p class="hint">
              {{
                $pt(
                  "沿用现有按城市、越南时间、真实营业状态和评价排序的规则。可选择不同时段预览，不更改生产时间。",
                )
              }}
            </p>
            <div class="p-inline">
              <select v-model="previewCity">
                <option>{{ $pt("北宁") }}</option>
                <option>{{ $pt("北江") }}</option></select
              ><input v-model="previewAt" type="datetime-local" /><button
                class="secondary"
                :disabled="busy"
                @click="showPreview"
              >
                {{ $pt("预览当前时段") }}
              </button>
            </div>
          </article>
          <article class="card">
            <div class="section-heading">
              <h2>{{ $pt("人工推荐与首页分类") }}</h2>
              <div class="p-inline">
                <input v-model="keyword" :placeholder="$pt('搜索商家')" /><input
                  v-model="city"
                  :placeholder="$pt('筛选城市')"
                />
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{{ $pt("商家") }}</th>
                    <th>{{ $pt("城市") }}</th>
                    <th>{{ $pt("人工推荐") }}</th>
                    <th>{{ $pt("首页分类") }}</th>
                    <th>{{ $pt("当前展示") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in filteredMerchants" :key="m.id">
                    <td>
                      {{ m.nameZh
                      }}<small class="p-cell-sub">{{ m.nameVi }}</small>
                    </td>
                    <td>{{ m.city }}</td>
                    <td>
                      <input
                        v-model="rec(m.id).manualPopular"
                        type="checkbox"
                        :aria-label="`推荐${m.nameZh}`"
                      />
                    </td>
                    <td>
                      <details>
                        <summary>
                          {{ rec(m.id).homepageCategoryKeys.length
                          }}{{ $pt("个分类") }}
                        </summary>
                        <div
                          class="p-inline"
                          style="max-width: 480px; margin-top: 12px"
                        >
                          <label
                            v-for="item in legacy"
                            :key="item.value"
                            class="p-tag-check"
                            ><input
                              v-model="rec(m.id).homepageCategoryKeys"
                              type="checkbox"
                              :value="item.value"
                            />{{ $pt(item.label) }}</label
                          >
                        </div>
                      </details>
                    </td>
                    <td>
                      <span
                        class="badge"
                        :class="m.isVisibleOnClient ? 'success' : 'muted'"
                        >{{
                          m.isVisibleOnClient ? $pt("展示中") : $pt("隐藏")
                        }}</span
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article></template
        >
        <div class="p-sticky-actions">
          <span
            >{{ dirty ? $pt("有未保存修改") : $pt("草稿与当前页面一致")
            }}{{ $pt("· 分类、专题、标签及推荐统一发布") }}</span
          ><button
            class="secondary"
            :disabled="busy || content.conflicted"
            @click="save"
          >
            {{ $pt("保存草稿") }}</button
          ><button :disabled="busy || content.conflicted" @click="showPreview">
            {{ $pt("预览与发布") }}
          </button>
        </div>
      </template>
    </template>
    <PlatformDrawer
      :open="!!quick"
      :title="quick?.nameZh || '标签快览'"
      @close="quick = undefined"
      ><template v-if="quick"
        ><p>{{ quick.description || $pt("尚无说明") }}</p>
        <p>
          {{ $pt("修改后将影响")
          }}{{ impact?.total ?? quick.merchantReferenceCount
          }}{{ $pt("家关联商家。") }}
        </p>
        <RouterLink
          v-for="m in impact?.items"
          :key="m.id"
          :to="`/platform/merchants/${m.id}`"
          class="p-result"
          ><span
            >{{ m.nameZh }}<small>{{ m.city }}</small></span
          ><span>→</span></RouterLink
        >
        <p v-if="impact && impact.total > impact.items.length" class="hint">
          {{ $pt("此处展示前") }}{{ impact.items.length
          }}{{ $pt("家，发布影响全部") }}{{ impact.total }}{{ $pt("家。") }}
        </p></template
      ><template #footer
        ><RouterLink
          v-if="quick"
          class="p-drawer-edit"
          :to="`/platform/promotion-tags/${quick.id}`"
          >{{ $pt("进入完整编辑 →") }}</RouterLink
        ></template
      ></PlatformDrawer
    >
    <PlatformDrawer
      :open="previewOpen"
      :title="$pt('内容预览与统一发布')"
      wide
      @close="previewOpen = false"
      ><div class="p-preview-controls">
        <label
          >{{ $pt("城市")
          }}<select v-model="previewCity">
            <option>{{ $pt("北宁") }}</option>
            <option>{{ $pt("北江") }}</option>
          </select></label
        ><label
          >{{ $pt("预览时间 · UTC+7")
          }}<input v-model="previewAt" type="datetime-local" /></label
        ><button class="secondary" :disabled="busy" @click="showPreview">
          {{ $pt("更新预览") }}
        </button>
      </div>
      <template v-if="preview"
        ><p class="hint">{{ preview.notice }}</p>
        <p>
          {{ preview.city }} · {{ vietnamTime(preview.at) }} ·
          {{ preview.recommendations?.period?.nameZh }}
        </p>
        <h3>{{ $pt("生活分类") }}</h3>
        <div class="p-preview-chips">
          <span v-for="c in preview.categories" :key="c.code">{{
            c.nameZh
          }}</span>
        </div>
        <h3>{{ $pt("场景专题") }}</h3>
        <div v-for="topic in preview.topics" :key="topic.code" class="p-result">
          <span
            >{{ topic.nameZh }}<small>{{ topic.subtitleZh }}</small></span
          >
        </div>
        <h3>{{ $pt("自动推荐") }}</h3>
        <article
          v-for="item in [
            ...(preview.recommendations?.spotlights || []),
            ...(preview.recommendations?.scenes || []),
          ]"
          :key="item.code || item.kind"
          class="p-preview-merchant"
        >
          <img
            v-if="item.photos?.[0]"
            :src="resolveMediaUrl(item.photos[0])"
            alt=""
          />
          <div>
            <strong>{{ item.titleZh || item.kind }}</strong>
            <p>{{ item.merchant?.nameZh }}</p>
            <small>{{
              item.merchant?.isOpen ? $pt("预览时营业") : $pt("预览时未营业")
            }}</small>
          </div>
        </article>
        <h3>{{ $pt("发布范围") }}</h3><div v-for="change in preview.tagChanges||[]" :key="change.id" class="p-result"><span><strong>{{ change.before?`${change.before} → ${change.after}`:change.after }}</strong><small>{{ $pt('关联商家') }} {{ change.affectedMerchantCount }} · {{ $pt(change.enabled?'启用':'停用') }}</small></span></div>
        <p class="hint">
          {{
            $pt(
              "统一发布当前草稿中的分类、场景专题、公共标签文案和人工推荐。已关联的商家同步引用新的标签文案。",
            )
          }}
        </p></template
      >
      <p v-if="message" role="status">{{ $pt(message) }}</p>
      <template #footer
        ><button class="secondary" @click="previewOpen = false">
          {{ $pt("返回调整") }}</button
        ><button :disabled="busy || !preview" @click="publish">
          {{ busy ? $pt("正在发布…") : $pt("确认统一发布") }}
        </button></template
      ></PlatformDrawer
    >
  </section>
</template>
