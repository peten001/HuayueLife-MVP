<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import PlatformMerchantItemsEditor, {
  type DisplayItem,
} from "@/components/platform/PlatformMerchantItemsEditor.vue";
import PlatformDrawer from "@/components/platform/PlatformDrawer.vue";
import MerchantIcon from "@/components/MerchantIcon.vue";
import { errorMessage } from "@/api/http";
import {
  exploreRequest,
  getPlatformBusinessTypes,
  getPlatformPromotionTags,
  uploadPlatformMerchantImage,
} from "@/api/platform";
import type { PlatformBusinessType, PlatformPromotionTag } from "@/types/api";
import { resolveMediaUrl } from "@/utils/media";
import { vietnamTime } from "@/utils/platform-format";
const route = useRoute();
const router = useRouter();
type Image = {
  id?: string;
  clientKey?: string;
  imageType: string;
  imageUrl: string;
  titleZh?: string;
  titleVi?: string;
  titleEn?: string;
  sortOrder: number;
  isVisible: boolean;
};
type Draft = {
  profile: Record<string, any>;
  images: Image[];
  tagIds: string[];
  version: number;
  baseRevision: string;
  savedAt?: string;
  missing?: string[];
  conflicted?: boolean;
  currentRevision?: string;
  contentCounts?: { menu: number; services: number };
  current?: {
    profile: Record<string, any>;
    images: Image[];
    tagIds: string[];
    signatureDishes?: DisplayItem[];
    serviceItems?: DisplayItem[];
  };
  currentlyVisible?: boolean;
  claimStatus?: string;
  signatureDishes?: DisplayItem[];
  serviceItems?: DisplayItem[];
};
const draft = ref<Draft>();
const types = ref<PlatformBusinessType[]>([]);
const tags = ref<PlatformPromotionTag[]>([]);
const loading = ref(false);
const saving = ref(false);
const message = ref("");
const success = ref("");
const initial = ref("");
const tab = ref("profile");
const conflictOpen = ref(false);
const days = [
  ["monday", "周一"],
  ["tuesday", "周二"],
  ["wednesday", "周三"],
  ["thursday", "周四"],
  ["friday", "周五"],
  ["saturday", "周六"],
  ["sunday", "周日"],
];
function setQuickHours() {
  if (!draft.value) return;
  const match = String(draft.value.profile.openingHoursText || "")
    .replace(/[–—]/g, "-")
    .match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
  if (match)
    draft.value.profile.businessHours = Object.fromEntries(
      days.map(([key]) => [key, [`${match[1]}-${match[2]}`]]),
    );
}
function addHours(day: string) {
  if (!draft.value) return;
  draft.value.profile.businessHours ||= {};
  draft.value.profile.businessHours[day] ||= [];
  draft.value.profile.businessHours[day].push("09:00-22:00");
}
function rebase(keep: boolean) {
  if (!draft.value?.currentRevision) return;
  if (!keep && draft.value.current) {
    draft.value.profile = { ...draft.value.current.profile };
    draft.value.images = [...draft.value.current.images];
    draft.value.tagIds = [...draft.value.current.tagIds];
    draft.value.signatureDishes = JSON.parse(
      JSON.stringify(draft.value.current.signatureDishes || []),
    );
    draft.value.serviceItems = JSON.parse(
      JSON.stringify(draft.value.current.serviceItems || []),
    );
  }
  draft.value.baseRevision = draft.value.currentRevision;
  draft.value.conflicted = false;
  conflictOpen.value = false;
  message.value = "已核对最新资料，请保存草稿或更新。";
}

const newName = ref("");
const newCity = ref("");
const isNew = computed(() => route.path.endsWith("/new"));
function draftState(value: Draft) {
  return JSON.stringify([
    value.profile,
    value.images,
    value.tagIds,
    value.signatureDishes || [],
    value.serviceItems || [],
  ]);
}
const dirty = computed(
  () => !!draft.value && draftState(draft.value) !== initial.value,
);
const selectedType = computed(() =>
  types.value.find((t) => t.id === draft.value?.profile.businessTypeId),
);
const liveMissing = computed(() => {
  if (!draft.value) return [];
  const p = draft.value.profile;
  const required = [
    ["nameZh", "中文店名"],
    ["nameVi", "越南文店名"],
    ["city", "城市"],
    ["businessTypeId", "行业"],
    ["contactName", "联系人"],
    ["contactPhone", "联系电话"],
    ["addressZh", "中文地址"],
    ["addressVi", "越南文地址"],
    ["coverUrl", "封面"],
    ["descriptionZh", "中文介绍"],
    ["descriptionVi", "越南文介绍"],
  ];
  const missing = required
    .filter(([key]) => !String(p[key] ?? "").trim())
    .map(([, label]) => label);
  if (
    p.latitude === "" ||
    p.longitude === "" ||
    p.latitude == null ||
    p.longitude == null ||
    !Number.isFinite(Number(p.latitude)) ||
    !Number.isFinite(Number(p.longitude)) ||
    Math.abs(Number(p.latitude)) > 90 ||
    Math.abs(Number(p.longitude)) > 180 ||
    (Number(p.latitude) === 0 && Number(p.longitude) === 0)
  )
    missing.push("精确定位");
  if (
    !String(p.openingHoursText || "").trim() &&
    !Object.keys(p.businessHours || {}).length
  )
    missing.push("营业时间");
  const code = selectedType.value?.code || "";
  const kind =
    selectedType.value?.contentTemplate ||
    ([
      "FOOD_SERVICE",
      "CHINESE_RESTAURANT",
      "NOODLE_SNACK",
      "VIETNAMESE_FOOD",
      "COFFEE_TEA",
      "RESTAURANT",
      "CAKE",
    ].includes(code)
      ? "RESTAURANT"
      : code === "HOTEL"
        ? "HOTEL"
        : ["MASSAGE_SPA", "KTV", "HAIR_BEAUTY", "SPORT_LEISURE"].includes(code)
          ? "SERVICE"
          : "GENERAL");
  const images = draft.value.images.filter(
    (i) => i.isVisible && ["PRODUCT", "MENU"].includes(i.imageType),
  );
  if (
    kind === "RESTAURANT" &&
    !(
      (draft.value.contentCounts?.menu || 0) +
      (draft.value.claimStatus === "CLAIMED"
        ? 0
        : draft.value.signatureDishes?.filter(
            (item) => item.isVisible && item.nameZh.trim() && item.imageUrl,
          )?.length || 0) +
      images.length
    )
  )
    missing.push("菜单或菜品");
  else if (
    kind !== "RESTAURANT" &&
    !(
      (draft.value.serviceItems?.filter(
        (item) => item.isVisible && item.nameZh.trim(),
      ).length ??
        draft.value.contentCounts?.services ??
        0) + images.filter((i) => i.titleZh?.trim()).length
    )
  )
    missing.push(
      kind === "HOTEL"
        ? "房型"
        : kind === "SERVICE"
          ? "服务项目"
          : "商品或展示项目",
    );
  return missing;
});
const contentLabel = computed(() =>
  selectedType.value?.code === "HOTEL"
    ? "房型"
    : ["MASSAGE_SPA", "HAIR_BEAUTY", "KTV", "SPORT_LEISURE"].includes(
          selectedType.value?.code || "",
        )
      ? "服务项目"
      : "菜品 / 商品",
);
const fields = [
  ["nameZh", "中文店名", 120],
  ["nameVi", "越南文店名", 120],
  ["nameEn", "英文店名（选填）", 120],
  ["city", "城市", 80],
  ["contactName", "联系人", 64],
  ["contactPhone", "联系电话", 32],
] as const;
const queue = ref<
  Array<{
    key: number;
    file: File;
    imageType: string;
    state: "waiting" | "uploading" | "done" | "failed";
    error?: string;
    target?: Image;
  }>
>([]);
const itemsUploading = ref(false);
const uploading = computed(
  () =>
    itemsUploading.value ||
    queue.value.some(
      (item) => item.state === "uploading" || item.state === "waiting",
    ),
);
let uploadSerial = 0;
let saveExit = false;
onMounted(async () => {
  if (!isNew.value) await load();
});
async function load() {
  loading.value = true;
  message.value = "";
  try {
    const [data, businessTypes, promotionTags] = await Promise.all([
      exploreRequest<Draft>(
        "get",
        `/platform/workbench/merchants/${route.params.id}/draft`,
      ),
      getPlatformBusinessTypes(),
      getPlatformPromotionTags(),
    ]);
    data.signatureDishes ||= [];
    data.serviceItems ||= [];
    draft.value = data;
    types.value = businessTypes;
    tags.value = promotionTags;
    initial.value = draftState(data);
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}
async function create() {
  saving.value = true;
  message.value = "";
  try {
    const item = await exploreRequest<{ id: string }>(
      "post",
      "/platform/workbench/merchant-drafts",
      { nameZh: newName.value, city: newCity.value },
    );
    await router.replace(`/platform/merchants/${item.id}`);
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}
async function save(publish = false) {
  if (!draft.value || uploading.value) return;
  saving.value = true;
  message.value = "";
  success.value = "";
  try {
    const data = await exploreRequest<Draft>(
      publish ? "post" : "put",
      `/platform/workbench/merchants/${route.params.id}/${publish ? "publish" : "draft"}`,
      draft.value,
    );
    if (!publish) draft.value = { ...draft.value, ...data };
    initial.value = draftState(draft.value);
    success.value = publish
      ? "已保存并更新对外展示"
      : "草稿已保存，当前展示保持原样";
    if (publish) await load();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}
const cropFile = ref<File>();
const cropUrl = ref("");
const cropRatio = ref(16 / 9);
const cropZoom = ref(1);
const cropX = ref(50);
const cropY = ref(50);
const cropSize = ref({ width: 1, height: 1 });
const cropping = ref(false);
const cropStyle = computed(() => {
  const { width: w, height: h } = cropSize.value;
  const factor = Math.max(1 / w, 1 / (cropRatio.value * h)) * cropZoom.value;
  const width = w * factor * 100;
  const height = h * factor * cropRatio.value * 100;
  return {
    width: `${width}%`,
    height: `${height}%`,
    left: `${(-(width - 100) * cropX.value) / 100}%`,
    top: `${(-(height - 100) * cropY.value) / 100}%`,
  };
});
function closeCrop() {
  cropFile.value = undefined;
  if (cropUrl.value) URL.revokeObjectURL(cropUrl.value);
  cropUrl.value = "";
}
const failedPhotos = ref(new Set<string>());
const gallery = computed(() =>
  [...(draft.value?.images || [])]
    .filter((i) => !["LOGO", "COVER"].includes(i.imageType))
    .sort((a, b) => a.sortOrder - b.sortOrder),
);
async function replaceImage(event: Event, image: Image) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  const key = ++uploadSerial;
  queue.value.push({
    key,
    file,
    imageType: image.imageType,
    state: "waiting",
    target: image,
  });
  await upload(key);
}
function moveImage(image: Image, offset: number) {
  const ordered = [...gallery.value];
  const from = ordered.indexOf(image);
  const to = from + offset;
  if (to < 0 || to >= ordered.length) return;
  ordered.splice(from, 1);
  ordered.splice(to, 0, image);
  ordered.forEach((item, index) => (item.sortOrder = index));
}
async function enqueue(files: File[], imageType: string) {
  const batch = files.map((file) => ({
    key: ++uploadSerial,
    file,
    imageType,
    state: "waiting" as const,
  }));
  queue.value.push(...batch);
  for (const item of batch) await upload(item.key);
}
async function addFiles(event: Event, imageType: string) {
  const files = [...((event.target as HTMLInputElement).files || [])];
  (event.target as HTMLInputElement).value = "";
  if (
    imageType !== "COVER" ||
    !files[0] ||
    files[0].size > 20 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(files[0].type)
  ) {
    await enqueue(files, imageType);
    return;
  }
  closeCrop();
  cropFile.value = files[0];
  cropUrl.value = URL.createObjectURL(files[0]);
  cropZoom.value = 1;
  cropX.value = 50;
  cropY.value = 50;
  const picture = new window.Image();
  picture.onload = () => {
    cropSize.value = {
      width: picture.naturalWidth,
      height: picture.naturalHeight,
    };
  };
  picture.onerror = () => {
    message.value = "图片无法读取，请选择有效的 JPEG、PNG 或 WebP 文件";
    closeCrop();
  };
  picture.src = cropUrl.value;
}
async function useWholeCover() {
  const file = cropFile.value;
  if (!file) return;
  closeCrop();
  await enqueue([file], "COVER");
}
async function applyCrop() {
  const file = cropFile.value;
  if (!file) return;
  cropping.value = true;
  message.value = "";
  try {
    const picture = new window.Image();
    picture.src = cropUrl.value;
    await picture.decode();
    const { naturalWidth: w, naturalHeight: h } = picture;
    const factor = Math.max(1 / w, 1 / (cropRatio.value * h)) * cropZoom.value;
    const sourceW = 1 / factor;
    const sourceH = sourceW / cropRatio.value;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.min(2000, Math.floor(sourceW)));
    canvas.height = Math.max(1, Math.round(canvas.width / cropRatio.value));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片预览暂不可用");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      picture,
      ((w - sourceW) * cropX.value) / 100,
      ((h - sourceH) * cropY.value) / 100,
      sourceW,
      sourceH,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("图片处理失败"))),
        "image/png",
      ),
    );
    if (cropFile.value !== file) return;
    const cropped = new File(
      [blob],
      file.name.replace(/\.[^.]+$/, "") + "-cover.png",
      { type: "image/png" },
    );
    closeCrop();
    await enqueue([cropped], "COVER");
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    cropping.value = false;
  }
}
onBeforeUnmount(closeCrop);
async function upload(key: number) {
  const item = queue.value.find((i) => i.key === key);
  if (!item || !draft.value) return;
  item.state = "uploading";
  item.error = "";
  try {
    if (item.file.size > 20 * 1024 * 1024)
      throw new Error("单张图片不能超过 20MB");
    if (!["image/jpeg", "image/png", "image/webp"].includes(item.file.type))
      throw new Error("请选择 JPEG、PNG 或 WebP 图片");
    const result = await uploadPlatformMerchantImage(item.file);
    if (item.target) {
      if (!draft.value.images.includes(item.target))
        throw new Error("图片已移除，请重新添加");
      item.target.imageUrl = result.imageUrl;
    } else if (item.imageType === "COVER")
      draft.value.profile.coverUrl = result.imageUrl;
    else if (item.imageType === "LOGO")
      draft.value.profile.logoUrl = result.imageUrl;
    else
      draft.value.images.push({
        clientKey: crypto.randomUUID(),
        imageType: item.imageType,
        imageUrl: result.imageUrl,
        titleZh: "",
        titleVi: "",
        sortOrder: draft.value.images.length,
        isVisible: true,
      });
    item.state = "done";
  } catch (error) {
    item.state = "failed";
    item.error = errorMessage(error);
  }
}
function removeImage(image: Image) {
  if (draft.value)
    draft.value.images = draft.value.images.filter((i) => i !== image);
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || uploading.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
onBeforeRouteLeave(() => {
  if (saveExit) return true;
  if (uploading.value) {
    message.value = "图片正在处理，请等待本批次完成后离开";
    return false;
  }
  if (dirty.value)
    return window.confirm("有尚未保存的修改，离开后将丢失。是否离开？");
  return true;
});
</script>
<template>
  <section>
    <PageHeader
      :title="isNew ? '新增商家' : '商家资料'"
      :description="
        isNew
          ? '先保存店名与城市，再逐步完善资料。'
          : '资料、图片和标签统一保存草稿，确认后再更新对外展示。'
      "
      ><RouterLink class="button-link secondary" to="/platform/merchants">{{
        $pt("返回列表")
      }}</RouterLink></PageHeader
    >
    <p v-if="message" class="error" role="alert">{{ $pt(message) }}</p>
    <p v-if="success" class="p-status-note" role="status">{{ $pt(success) }}</p>
    <form v-if="isNew" class="card" @submit.prevent="create">
      <h2>{{ $pt("建立商家草稿") }}</h2>
      <div class="p-form-grid">
        <label
          >{{ $pt("店名")
          }}<input
            v-model="newName"
            required
            maxlength="120"
            :placeholder="$pt('填写门店名称')" /></label
        ><label
          >{{ $pt("城市")
          }}<input
            v-model="newCity"
            required
            maxlength="80"
            :placeholder="$pt('例如：北宁')"
        /></label>
      </div>
      <p class="p-summary-note">
        {{ $pt("草稿仅在平台后台保留。资料按行业清单补齐后，才能公开展示。") }}
      </p>
      <button :disabled="saving">
        {{ saving ? $pt("正在保存…") : $pt("保存草稿并继续") }}</button
      ><RouterLink
        class="button-link secondary"
        to="/platform/merchants/import"
        style="margin-left: 12px"
        >{{ $pt("批量导入") }}</RouterLink
      >
    </form>
    <p v-if="loading" role="status">{{ $pt("正在加载商家资料…") }}</p>
    <template v-if="draft && !isNew">
      <div class="p-inline" style="margin-bottom: 20px">
        <h2 style="margin: 0">{{ draft.profile.nameZh }}</h2>
        <span
          class="badge"
          :class="draft.currentlyVisible ? 'success' : 'muted'"
          >{{
            draft.currentlyVisible ? $pt("当前已展示") : $pt("当前未展示")
          }}</span
        ><span class="p-muted">{{
          draft.savedAt
            ? `草稿保存于 ${vietnamTime(draft.savedAt)}`
            : $pt("尚无未发布草稿")
        }}</span
        ><RouterLink
          style="margin-left: auto"
          :to="`/platform/merchants/${route.params.id}/operations`"
          >{{ $pt("经营能力与账号 →") }}</RouterLink
        >
      </div>
      <p v-if="draft.conflicted" class="error">
        {{ $pt("线上资料已更新，请重新加载核对后再保存。")
        }}<button class="secondary small" @click="conflictOpen = true">
          {{ $pt("核对版本") }}
        </button>
      </p>
      <nav class="p-section-tabs">
        <button
          v-for="item in [
            { key: 'profile', label: '基础资料' },
            { key: 'images', label: '图片与展示项目' },
            { key: 'tags', label: '标签与发布' },
          ]"
          :key="item.key"
          class="secondary"
          :aria-pressed="tab === item.key"
          @click="tab = item.key"
        >
          {{ $pt(item.label) }}
        </button>
      </nav>
      <div v-show="tab === 'profile'" class="card">
        <h2>{{ $pt("身份与联系方式") }}</h2>
        <div class="p-form-grid">
          <label v-for="field in fields" :key="field[0]"
            >{{ $pt(field[1])
            }}<input
              v-model="draft.profile[field[0]]"
              :maxlength="field[2]" /></label
          ><label
            >{{ $pt("经营行业")
            }}<select
              v-model="draft.profile.businessTypeId"
              :aria-label="$pt('经营行业')"
            >
              <option value="">{{ $pt("请选择行业") }}</option>
              <option
                v-for="type in types.filter((t) => t.enabled)"
                :key="type.id"
                :value="type.id"
              >
                {{ type.nameZh }}
              </option>
            </select></label
          ><label
            >{{ $pt("营业时间")
            }}<input
              v-model="draft.profile.openingHoursText"
              @change="setQuickHours"
              maxlength="255"
              :placeholder="$pt('例如：每天 09:00–22:00')"
          /></label>
        </div>
        <details class="p-weekly-hours">
          <summary>{{ $pt("按星期设置营业时间") }}</summary>
          <p class="hint">
            {{ $pt("每段填写 HH:mm-HH:mm，支持跨天；没有时段表示当天休息。") }}
          </p>
          <div
            v-for="day in days"
            :key="day[0]"
            class="p-inline"
            style="margin: 12px 0"
          >
            <span style="width: 40px">{{ $pt(day[1]) }}</span>
            <div
              v-for="(range, index) in draft.profile.businessHours?.[day[0]] ||
              []"
              :key="index"
              class="p-inline"
            >
              <input
                v-model="draft.profile.businessHours[day[0]][index]"
                aria-label="营业时段"
                placeholder="09:00-22:00"
                style="width: 150px"
              /><button
                type="button"
                class="text-button"
                @click="draft.profile.businessHours[day[0]].splice(index, 1)"
              >
                {{ $pt("移除") }}
              </button>
            </div>
            <button
              type="button"
              class="secondary small"
              @click="addHours(day[0])"
            >
              {{ $pt("添加时段") }}
            </button>
          </div>
        </details>
        <h2 style="margin-top: 32px">{{ $pt("地址与定位") }}</h2>
        <div class="p-form-grid">
          <label
            v-for="language in ['Zh', 'Vi', 'En']"
            :key="language"
            class="full"
            >{{
              language === "Zh"
                ? $pt("中文地址")
                : language === "Vi"
                  ? $pt("越南文地址")
                  : $pt("英文地址（选填）")
            }}<input
              v-model="draft.profile[`address${language}`]"
              maxlength="255" /></label
          ><label
            >{{ $pt("纬度")
            }}<input
              v-model="draft.profile.latitude"
              type="number"
              min="-90"
              max="90"
              step="0.0000001"
              :placeholder="$pt('例如：21.1861')" /></label
          ><label
            >{{ $pt("经度")
            }}<input
              v-model="draft.profile.longitude"
              type="number"
              min="-180"
              max="180"
              step="0.0000001"
              :placeholder="$pt('例如：106.0763')"
          /></label>
        </div>
        <h2 style="margin-top: 32px">{{ $pt("商家介绍") }}</h2>
        <div class="p-form-grid">
          <label
            v-for="language in ['Zh', 'Vi', 'En']"
            :key="language"
            class="full"
            >{{
              language === "Zh"
                ? $pt("中文介绍")
                : language === "Vi"
                  ? $pt("越南文介绍")
                  : $pt("英文介绍（选填）")
            }}<textarea
              v-model="draft.profile[`description${language}`]"
              maxlength="20000"
            />
          </label>
        </div>
      </div>
      <div v-show="tab === 'images'">
        <PlatformMerchantItemsEditor
          v-if="
            draft.signatureDishes &&
            (selectedType?.contentTemplate === 'RESTAURANT' ||
              [
                'FOOD_SERVICE',
                'CHINESE_RESTAURANT',
                'NOODLE_SNACK',
                'VIETNAMESE_FOOD',
                'COFFEE_TEA',
                'RESTAURANT',
                'CAKE',
              ].includes(selectedType?.code || ''))
          "
          v-model="draft.signatureDishes"
          restaurant
          :menu-managed="draft.claimStatus === 'CLAIMED'"
          :menu-count="draft.contentCounts?.menu"
          title="招牌菜"
          @busy="itemsUploading = $event"
        /><PlatformMerchantItemsEditor
          v-else-if="draft.serviceItems"
          v-model="draft.serviceItems"
          :restaurant="false"
          :title="contentLabel"
          @busy="itemsUploading = $event"
        />
        <article class="card">
          <h2>{{ $pt("封面与 Logo") }}</h2>
          <p class="hint">
            {{
              $pt(
                "单张源文件最多 20MB，自动优化清晰度与体积；服务器仅保存展示图和列表小图。更换图片会先进入草稿。",
              )
            }}
          </p>
          <div class="p-mini-grid">
            <label
              v-for="item in [
                { field: 'coverUrl', name: '封面', type: 'COVER' },
                { field: 'logoUrl', name: 'Logo', type: 'LOGO' },
              ]"
              :key="item.field"
              class="p-upload-card"
              ><span>{{ $pt(item.name) }}</span
              ><img
                v-if="draft.profile[item.field]"
                :src="resolveMediaUrl(draft.profile[item.field])"
                :alt="item.name" /><span v-else class="p-photo-empty">{{
                $pt("尚未上传")
              }}</span
              ><input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                @change="addFiles($event, item.type)"
            /></label>
          </div>
        </article>
        <article class="card">
          <div class="section-heading">
            <h2>{{ $pt("相册与") }}{{ $pt(contentLabel) }}</h2>
            <span class="badge"
              >{{ draft.images.length }}{{ $pt("张 · 不限数量") }}</span
            >
          </div>
          <div class="p-inline">
            <label
              v-for="item in [
                { type: 'STORE', label: '门店外观' },
                { type: 'ENVIRONMENT', label: '门店环境' },
                { type: 'PRODUCT', label: contentLabel },
                { type: 'MENU', label: '菜单' },
              ]"
              :key="item.type"
              class="p-upload-button"
              >{{ $pt("添加") }}{{ $pt(item.label)
              }}<input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                @change="addFiles($event, item.type)"
            /></label>
          </div>
          <p class="hint">
            {{
              $pt(
                "支持横图、竖图和方图。房型、服务或商品请填写名称。排序数字越小越靠前。",
              )
            }}
          </p>
          <div class="p-photo-grid">
            <article
              v-for="(image, index) in gallery"
              :key="image.id || image.clientKey || `new-${index}`"
              class="p-photo-card"
            >
              <img
                v-if="!failedPhotos.has(image.imageUrl)"
                :src="resolveMediaUrl(image.imageUrl)"
                :alt="image.titleZh || image.imageType"
                loading="lazy"
                @error="failedPhotos.add(image.imageUrl)"
              />
              <div
                v-if="failedPhotos.has(image.imageUrl)"
                class="p-photo-fallback"
              >
                <span>{{ $pt("图片暂不可用") }}</span
                ><button
                  class="secondary small"
                  @click="failedPhotos.delete(image.imageUrl)"
                >
                  {{ $pt("重试") }}
                </button>
              </div>
              <div>
                <span class="badge">{{
                  image.imageType === "MENU"
                    ? $pt("菜单")
                    : image.imageType === "PRODUCT"
                      ? $pt(contentLabel)
                      : image.imageType === "STORE"
                        ? $pt("门店外观")
                        : $pt("门店环境")
                }}</span
                ><input
                  v-model="image.titleZh"
                  :placeholder="$pt('中文名称')"
                  maxlength="120"
                /><input
                  v-model="image.titleVi"
                  placeholder="Tên tiếng Việt"
                  maxlength="120"
                />
                <div class="p-inline">
                  <label class="p-upload-button"
                    >{{ $pt("替换")
                    }}<input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      :disabled="uploading"
                      @change="replaceImage($event, image)" /></label
                  ><button
                    class="p-icon-button"
                    :disabled="uploading || index === 0"
                    :aria-label="$pt('上移')"
                    @click="moveImage(image, -1)"
                  >
                    ↑</button
                  ><button
                    class="p-icon-button"
                    :disabled="uploading || index === gallery.length - 1"
                    :aria-label="$pt('下移')"
                    @click="moveImage(image, 1)"
                  >
                    ↓
                  </button>
                </div>
                <div class="p-inline">
                  <input
                    v-model.number="image.sortOrder"
                    type="number"
                    min="0"
                    :aria-label="$pt('排序')"
                    style="width: 72px"
                  /><label
                    ><input v-model="image.isVisible" type="checkbox" />{{
                      $pt("展示")
                    }}</label
                  ><button
                    class="p-icon-button"
                    :disabled="uploading"
                    :aria-label="$pt('从草稿移除图片')"
                    @click="removeImage(image)"
                  >
                    <MerchantIcon name="close" />
                  </button>
                </div>
              </div>
            </article>
          </div>
          <p v-if="!draft.images.length" class="empty-state">
            {{ $pt("添加门店照片和展示项目，让顾客更了解这家店。") }}
          </p>
        </article>
        <article v-if="queue.length" class="card">
          <h2>{{ $pt("本次上传") }}</h2>
          <div v-for="item in queue" :key="item.key" class="p-upload-row">
            <span>{{ item.file.name }}</span
            ><small>{{
              item.state === "done"
                ? $pt("已加入草稿")
                : item.state === "failed"
                  ? item.error
                  : item.state === "uploading"
                    ? $pt("正在优化…")
                    : $pt("排队中")
            }}</small
            ><button
              v-if="item.state === 'failed'"
              class="secondary small"
              @click="upload(item.key)"
            >
              {{ $pt("重试") }}
            </button>
          </div>
        </article>
      </div>
      <div v-show="tab === 'tags'">
        <article
          v-for="scope in [
            { key: 'OPERATIONAL', label: '运营标签' },
            { key: 'CUISINE', label: '菜系标签' },
            { key: 'SCENE', label: '场景标签' },
          ]"
          :key="scope.key"
          class="card"
        >
          <div class="section-heading">
            <h2>{{ $pt(scope.label) }}</h2>
            <RouterLink to="/platform/promotion-tags">{{
              $pt("管理标签库 →")
            }}</RouterLink>
          </div>
          <div class="p-inline">
            <label
              v-for="tag in tags.filter(
                (t) =>
                  t.scope === scope.key &&
                  (t.enabled || draft?.tagIds.includes(t.id)),
              )"
              :key="tag.id"
              class="p-tag-check"
              ><input
                v-model="draft.tagIds"
                type="checkbox"
                :value="tag.id"
                :disabled="!tag.enabled && !draft.tagIds.includes(tag.id)"
              />{{ tag.nameZh
              }}<small v-if="!tag.enabled">{{ $pt("已停用") }}</small></label
            >
          </div>
        </article>
        <article class="card">
          <h2>{{ $pt("展示设置") }}</h2>
          <label class="p-inline"
            ><input
              v-model="draft.profile.isVisibleOnClient"
              type="checkbox"
            />{{ $pt("本次发布后对外展示") }}</label
          >
          <p class="hint">
            {{
              $pt(
                "公开资料须包含中越双语、联系信息、定位、封面、营业时间，以及当前行业要求的展示项目。已有商家仍保留现有展示，完善后再更新。",
              )
            }}
          </p>
          <ul v-if="liveMissing.length" class="p-muted">
            <li v-for="field in liveMissing" :key="field">
              {{ $pt("待完善：") }}{{ $pt(field) }}
            </li>
          </ul>
        </article>
      </div>
      <div class="p-sticky-actions">
        <span>{{
          uploading
            ? $pt("图片正在处理…")
            : dirty
              ? $pt("有未保存的改动")
              : $pt("所有改动已保存")
        }}</span
        ><button
          class="secondary"
          :disabled="saving || uploading || draft.conflicted"
          @click="save(false)"
        >
          {{ saving ? $pt("正在保存…") : $pt("保存草稿") }}</button
        ><button
          :disabled="saving || uploading || draft.conflicted"
          @click="save(true)"
        >
          {{ $pt("保存并更新") }}
        </button>
      </div>
    </template>
    <PlatformDrawer
      :open="!!cropFile"
      :title="$pt('封面裁切预览')"
      wide
      @close="closeCrop"
      ><p class="hint">
        {{ $pt("可保留完整图片，也可调整封面构图；相册图片不受比例限制。") }}
      </p>
      <div class="p-crop-preview" :style="{ aspectRatio: String(cropRatio) }">
        <img
          v-if="cropUrl"
          :src="cropUrl"
          :style="cropStyle"
          alt="封面构图预览"
        />
      </div>
      <div class="p-crop-controls">
        <label
          >{{ $pt("预览比例")
          }}<select v-model.number="cropRatio" :aria-label="$pt('预览比例')">
            <option :value="16 / 9">16:9</option>
            <option :value="4 / 3">4:3</option>
            <option :value="1">1:1</option>
          </select></label
        ><label
          >{{ $pt("缩放")
          }}<input
            v-model.number="cropZoom"
            type="range"
            min="1"
            max="3"
            step="0.05" /></label
        ><label
          >{{ $pt("水平位置")
          }}<input
            v-model.number="cropX"
            type="range"
            min="0"
            max="100" /></label
        ><label
          >{{ $pt("垂直位置")
          }}<input v-model.number="cropY" type="range" min="0" max="100"
        /></label>
      </div>
      <template #footer
        ><button class="secondary" :disabled="cropping" @click="useWholeCover">
          {{ $pt("保持完整图片") }}</button
        ><button :disabled="cropping" @click="applyCrop">
          {{ $pt(cropping ? "正在处理…" : "应用裁切并上传") }}
        </button></template
      ></PlatformDrawer
    >
    <PlatformDrawer
      :open="conflictOpen"
      title="核对商家资料版本"
      wide
      @close="conflictOpen = false"
      ><template v-if="draft?.current"
        ><p>
          {{ $pt("线上资料已变化，请对照当前资料与草稿，选择继续方式。") }}
        </p>
        <table>
          <thead>
            <tr>
              <th>{{ $pt("资料字段") }}</th>
              <th>{{ $pt("当前线上资料") }}</th>
              <th>{{ $pt("当前草稿") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="field in [
                ...fields.map((f) => [f[0], f[1]]),
                ['addressZh', '中文地址'],
                ['addressVi', '越南文地址'],
                ['descriptionZh', '中文介绍'],
                ['descriptionVi', '越南文介绍'],
              ]"
              :key="field[0]"
            >
              <td>{{ $pt(field[1]) }}</td>
              <td>{{ draft.current.profile[field[0]] || "—" }}</td>
              <td>{{ draft.profile[field[0]] || "—" }}</td>
            </tr>
            <tr>
              <td>{{ $pt("图片数量") }}</td>
              <td>{{ draft.current.images.length }}</td>
              <td>{{ draft.images.length }}</td>
            </tr>
          </tbody>
        </table></template
      ><template #footer
        ><button class="secondary" @click="rebase(false)">
          {{ $pt("使用当前线上资料") }}</button
        ><button @click="rebase(true)">
          {{ $pt("保留草稿继续编辑") }}
        </button></template
      ></PlatformDrawer
    >
  </section>
</template>
