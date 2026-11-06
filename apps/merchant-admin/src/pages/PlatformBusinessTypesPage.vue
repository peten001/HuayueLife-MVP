<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import { errorMessage } from "@/api/http";
import {
  createPlatformBusinessType,
  disablePlatformBusinessType,
  getPlatformBusinessTypes,
  updatePlatformBusinessType,
} from "@/api/platform";
import type { MerchantMode, PlatformBusinessType } from "@/types/api";

const route = useRoute();
const router = useRouter();
const editorPage = computed(() => !!route.params.id);
const items = ref<PlatformBusinessType[]>([]);
const loading = ref(false);
const message = ref("");
const editingId = ref("");
const form = reactive({
  parentId: "",
  code: "",
  nameZh: "",
  nameVi: "",
  nameEn: "",
  iconUrl: "",
  sortOrder: 0,
  showOnHome: true,
  enabled: true,
  defaultMerchantMode: "DISPLAY" as MerchantMode,
  defaultCapabilities: {
    phoneEnabled: true,
    navigationEnabled: true,
    imageGalleryEnabled: true,
    productDisplayEnabled: false,
    onlineOrderEnabled: false,
    pickupEnabled: false,
    deliveryEnabled: false,
    qrOrderEnabled: false,
    tableManagementEnabled: false,
    printerEnabled: false,
    zaloReportEnabled: false,
    chatEnabled: false,
    voiceNotifyEnabled: false,
  } as Record<string, boolean>,
});

const capabilityLabels: Record<string, string> = {
  phoneEnabled: "电话",
  navigationEnabled: "导航",
  imageGalleryEnabled: "图片展示",
  productDisplayEnabled: "商品展示",
  onlineOrderEnabled: "在线下单（兼容）",
  pickupEnabled: "到店自取",
  deliveryEnabled: "商家配送",
  qrOrderEnabled: "到店扫码点餐",
  tableManagementEnabled: "桌台管理",
  printerEnabled: "打印机",
  zaloReportEnabled: "Zalo 日报",
  chatEnabled: "订单聊天",
  voiceNotifyEnabled: "语音播报",
};
const parentIds = computed(
  () =>
    new Set(
      items.value
        .map((item) => item.parentId)
        .filter((value): value is string => Boolean(value)),
    ),
);
const defaultCapabilityEntries = computed(() =>
  Object.entries(form.defaultCapabilities).filter(
    ([code]) => code !== "productDisplayEnabled",
  ),
);

onMounted(async () => {
  await loadItems();
  if (route.params.id && route.params.id !== "new") {
    const item = items.value.find((i) => i.id === route.params.id);
    if (item) edit(item);
  }
});

async function loadItems() {
  loading.value = true;
  message.value = "";
  try {
    items.value = await getPlatformBusinessTypes();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  editingId.value = "";
  form.code = "";
  form.parentId = "";
  form.nameZh = "";
  form.nameVi = "";
  form.nameEn = "";
  form.iconUrl = "";
  form.sortOrder = 0;
  form.showOnHome = true;
  form.enabled = true;
  form.defaultMerchantMode = "DISPLAY";
  Object.keys(form.defaultCapabilities).forEach((key) => {
    form.defaultCapabilities[key] = [
      "phoneEnabled",
      "navigationEnabled",
      "imageGalleryEnabled",
    ].includes(key);
  });
}

function edit(item: PlatformBusinessType) {
  if (!editorPage.value) {
    void router.push(`/platform/merchant-types/${item.id}`);
    return;
  }
  editingId.value = item.id;
  form.parentId = item.parentId ?? "";
  form.code = item.code;
  form.nameZh = item.nameZh;
  form.nameVi = item.nameVi ?? "";
  form.nameEn = item.nameEn ?? "";
  form.iconUrl = item.iconUrl ?? "";
  form.sortOrder = item.sortOrder;
  form.showOnHome = item.showOnHome;
  form.enabled = item.enabled;
  form.defaultMerchantMode = item.defaultMerchantMode;
  Object.keys(form.defaultCapabilities).forEach((key) => {
    form.defaultCapabilities[key] = Boolean(item.defaultCapabilities?.[key]);
  });
}

async function submit() {
  message.value = "";
  const payload = {
    code: form.code.trim(),
    parentId: form.parentId || undefined,
    nameZh: form.nameZh.trim(),
    nameVi: form.nameVi.trim() || undefined,
    nameEn: form.nameEn.trim() || undefined,
    iconUrl: form.iconUrl.trim() || undefined,
    sortOrder: form.sortOrder,
    showOnHome: form.showOnHome,
    enabled: form.enabled,
    defaultMerchantMode: form.defaultMerchantMode,
    defaultCapabilities: { ...form.defaultCapabilities },
  };
  try {
    if (editingId.value) {
      await updatePlatformBusinessType(editingId.value, payload);
      message.value = "商家类型已更新";
    } else {
      await createPlatformBusinessType(payload);
      message.value = "商家类型已新增";
    }
    resetForm();
    await loadItems();
    if (editorPage.value) await router.push("/platform/merchant-types");
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function disable(item: PlatformBusinessType) {
  if (!window.confirm(`停用 ${item.nameZh}？`)) return;
  try {
    await disablePlatformBusinessType(item.id);
    await loadItems();
  } catch (error) {
    message.value = errorMessage(error);
  }
}
</script>

<template>
  <PageHeader
    :title="$pt('商家类型管理')"
    :description="$pt('经营类型是后台可配置字典，热门美食不属于商家类型。')"
    ><RouterLink
      class="button-link"
      :to="
        editorPage ? '/platform/merchant-types' : '/platform/merchant-types/new'
      "
      >{{ $pt(editorPage ? "返回列表" : "新增商家类型") }}</RouterLink
    ></PageHeader
  >
  <p v-if="message" class="message">{{ $pt(message) }}</p>

  <form v-if="editorPage" class="card form-grid" @submit.prevent="submit">
    <h2 class="span-2">
      {{ editingId ? $pt("编辑商家类型") : $pt("新增商家类型") }}
    </h2>
    <label
      >{{ $pt("编码")
      }}<input
        v-model="form.code"
        required
        maxlength="64"
        placeholder="COFFEE_TEA"
    /></label>
    <label
      >{{ $pt("父级类型")
      }}<select v-model="form.parentId">
        <option value="">{{ $pt("无父级") }}</option>
        <option
          v-for="item in items.filter((row) => row.id !== editingId)"
          :key="item.id"
          :value="item.id"
        >
          {{ "　".repeat(Math.max(0, item.level - 1)) }}{{ item.nameZh }}
        </option>
      </select>
    </label>
    <label
      >{{ $pt("中文名") }}<input v-model="form.nameZh" required maxlength="80"
    /></label>
    <label
      >{{ $pt("越南语名") }}<input v-model="form.nameVi" maxlength="80"
    /></label>
    <label
      >{{ $pt("英文名") }}<input v-model="form.nameEn" maxlength="80"
    /></label>
    <label class="span-2"
      >{{ $pt("图标 URL") }}<input v-model="form.iconUrl" maxlength="500"
    /></label>
    <label
      >{{ $pt("排序")
      }}<input v-model.number="form.sortOrder" type="number" min="0"
    /></label>
    <label
      >{{ $pt("默认模式")
      }}<select v-model="form.defaultMerchantMode">
        <option value="DISPLAY">{{ $pt("展示") }}</option>
        <option value="MANAGED">{{ $pt("经营管理") }}</option>
      </select>
    </label>
    <label class="check"
      ><input v-model="form.showOnHome" type="checkbox" />{{
        $pt("首页显示")
      }}</label
    >
    <label class="check"
      ><input v-model="form.enabled" type="checkbox" />{{ $pt("启用") }}</label
    >
    <section class="span-2 platform-homepage-categories">
      <strong>{{ $pt("默认能力") }}</strong>
      <div class="platform-category-options">
        <label
          v-for="entry in defaultCapabilityEntries"
          :key="entry[0]"
          class="platform-category-option"
        >
          <input v-model="form.defaultCapabilities[entry[0]]" type="checkbox" />
          <span>{{ $pt(capabilityLabels[entry[0]] ?? entry[0]) }}</span>
        </label>
      </div>
    </section>
    <div class="form-actions span-2">
      <button class="secondary" type="button" @click="resetForm">
        {{ $pt("清空") }}
      </button>
      <button type="submit">{{ editingId ? $pt("保存") : $pt("新增") }}</button>
    </div>
  </form>

  <section v-if="!editorPage" class="card">
    <div class="platform-table-header">
      <h2>{{ $pt("类型列表") }}</h2>
      <button class="secondary" :disabled="loading" @click="loadItems">
        {{ $pt("刷新") }}
      </button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ $pt("编码") }}</th>
            <th>{{ $pt("父级 / 层级") }}</th>
            <th>{{ $pt("名称") }}</th>
            <th>{{ $pt("默认模式") }}</th>
            <th>{{ $pt("首页") }}</th>
            <th>{{ $pt("排序") }}</th>
            <th>{{ $pt("状态") }}</th>
            <th>{{ $pt("操作") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.code }}</td>
            <td>
              {{ item.parentId || "-" }} / L{{ item.level }}<br /><small>{{
                item.path
              }}</small>
            </td>
            <td>
              {{ item.nameZh }}
              <span
                v-if="parentIds.has(item.id)"
                class="status-pill is-muted"
                >{{ $pt("父级分组") }}</span
              >
              <br /><small>{{ item.nameVi }} / {{ item.nameEn }}</small>
            </td>
            <td>{{ item.defaultMerchantMode }}</td>
            <td>{{ item.showOnHome ? $pt("显示") : $pt("不显示") }}</td>
            <td>{{ item.sortOrder }}</td>
            <td>{{ item.enabled ? $pt("启用") : $pt("停用") }}</td>
            <td>
              <button class="small secondary" @click="edit(item)">
                {{ $pt("编辑") }}
              </button>
              <button
                class="small warning"
                :disabled="!item.enabled"
                @click="disable(item)"
              >
                {{ $pt("停用") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
