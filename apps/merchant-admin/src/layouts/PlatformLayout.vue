<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import MerchantIcon from "@/components/MerchantIcon.vue";
import PlatformDrawer from "@/components/platform/PlatformDrawer.vue";
import { usePlatformLocale } from "@/composables/usePlatformLocale";
import { exploreRequest } from "@/api/platform";
import { errorMessage } from "@/api/http";
import {
  clearPlatformAdmin,
  clearPlatformToken,
  getPlatformAdmin,
} from "@/utils/storage";
const router = useRouter();
const route = useRoute();
const { t, locale, setLocale } = usePlatformLocale();
const adminName = getPlatformAdmin()?.username?.trim() || t("平台管理员");
const groups = [
  {
    label: "",
    items: [{ path: "dashboard", label: "运营总览", icon: "home" }],
  },
  {
    label: "商家中心",
    items: [
      { path: "merchants", label: "商家列表", icon: "store" },
      { path: "merchants/new", label: "新增与导入", icon: "plus" },
    ],
  },
  {
    label: "内容运营",
    items: [
      { path: "explore", label: "生活分类", icon: "products" },
      { path: "recommendations", label: "首页推荐", icon: "records" },
      { path: "promotion-tags", label: "标签库", icon: "filter" },
    ],
  },
  {
    label: "交易",
    items: [
      { path: "orders", label: "订单管理", icon: "orders" },
      { path: "reviews", label: "评价审核", icon: "edit" },
    ],
  },
  {
    label: "用户",
    items: [{ path: "users", label: "用户档案", icon: "user" }],
  },
  {
    label: "数据",
    items: [{ path: "analytics", label: "营业分析", icon: "home" }],
  },
  {
    label: "系统",
    items: [
      { path: "merchant-types", label: "行业与能力", icon: "tables" },
      { path: "settings", label: "平台设置", icon: "settings" },
    ],
  },
];
const allItems = groups.flatMap((group) => group.items);
const activeItem = computed(() =>
  [...allItems]
    .sort((a, b) => b.path.length - a.path.length)
    .find(
      (item) =>
        route.path === `/platform/${item.path}` ||
        route.path.startsWith(`/platform/${item.path}/`),
    ),
);
const drawer = ref<"search" | "queue" | "profile" | "">("");
const query = ref("");
const busy = ref(false);
const message = ref("");
const results = ref<
  Array<{
    id: string;
    label: string;
    detail: string;
    path: string;
    kind: string;
  }>
>([]);
const queue = ref<Array<{ label: string; count: number; path: string }>>([]);
let requestId = 0;
watch(
  () => route.fullPath,
  () => {
    drawer.value = "";
  },
);
watch(
  [() => route.path, locale],
  () => {
    document.title = `${t(activeItem.value?.label || "运营总览")} · YunQiao`;
    document.documentElement.lang =
      locale.value === "zh" ? "zh-CN" : locale.value;
  },
  { immediate: true },
);
async function search() {
  if (query.value.trim().length < 2) return;
  const id = ++requestId;
  busy.value = true;
  message.value = "";
  try {
    const data = await exploreRequest<{ items: typeof results.value }>(
      "get",
      `/platform/workbench/search?q=${encodeURIComponent(query.value.trim())}`,
    );
    if (id === requestId) results.value = data.items;
  } catch (error) {
    if (id === requestId) message.value = errorMessage(error);
  } finally {
    if (id === requestId) busy.value = false;
  }
}
async function openQueue() {
  drawer.value = "queue";
  busy.value = true;
  message.value = "";
  try {
    const data = await exploreRequest<{ items: typeof queue.value }>(
      "get",
      "/platform/workbench/queue",
    );
    queue.value = data.items;
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}
async function logout() {
  clearPlatformToken();
  clearPlatformAdmin();
  await router.push("/platform/login");
}
</script>
<template>
  <div class="app-shell platform-shell p-workbench">
    <aside class="sidebar platform-sidebar">
      <RouterLink class="p-brand" to="/platform/dashboard" aria-label="YunQiao"
        ><img src="/yunqiao-mark.png" alt="" /><span>YunQiao</span></RouterLink
      >
      <nav class="p-nav" aria-label="平台导航">
        <section v-for="group in groups" :key="group.label" class="p-nav-group">
          <p v-if="group.label" class="p-nav-label">{{ t(group.label) }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item.path"
            :to="`/platform/${item.path}`"
            class="p-nav-link"
            :class="{ active: activeItem?.path === item.path }"
            :aria-current="activeItem?.path === item.path ? 'page' : undefined"
          >
            <MerchantIcon :name="item.icon" /><span>{{ t(item.label) }}</span>
          </RouterLink>
        </section>
      </nav>
      <button class="p-profile" @click="drawer = 'profile'">
        <span class="p-avatar">{{ adminName.charAt(0).toUpperCase() }}</span
        ><span
          ><strong>{{ adminName }}</strong
          ><small>{{ t("平台管理员") }}</small></span
        ><MerchantIcon name="ellipsis" />
      </button>
    </aside>
    <main class="content platform-content">
      <header class="platform-topbar">
        <div class="p-breadcrumb">
          <span>YunQiao</span><span aria-hidden="true">/</span
          ><strong>{{ t(activeItem?.label || "运营总览") }}</strong>
        </div>
        <div class="p-top-actions">
          <button
            class="p-search-trigger"
            :aria-label="t('搜索商家、订单、用户')"
            @click="drawer = 'search'"
          >
            <MerchantIcon name="search" /><span>{{
              t("搜索商家、订单、用户")
            }}</span>
          </button>
          <button
            class="p-icon-button"
            :aria-label="t('待处理事项')"
            @click="openQueue"
          >
            <MerchantIcon name="records" />
          </button>
          <label class="p-locale"
            ><MerchantIcon name="language" /><select
              :value="locale"
              aria-label="Language"
              @change="
                setLocale(
                  ($event.target as HTMLSelectElement).value as
                    | 'zh'
                    | 'vi'
                    | 'en',
                )
              "
            >
              <option value="zh">中文</option>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select></label
          >
        </div>
      </header>
      <section class="platform-page-body">
        <RouterView v-slot="{ Component }"
          ><Transition name="p-page" mode="out-in"
            ><component :is="Component" :key="route.path" /></Transition
        ></RouterView>
      </section>
    </main>
    <PlatformDrawer
      :open="!!drawer"
      :title="
        t(
          drawer === 'search'
            ? '搜索结果'
            : drawer === 'queue'
              ? '待处理事项'
              : '个人中心',
        )
      "
      @close="drawer = ''"
    >
      <template v-if="drawer === 'search'">
        <form class="p-search-form" @submit.prevent="search">
          <input
            v-model="query"
            autofocus
            :placeholder="t('搜索商家、订单、用户')"
            minlength="2"
            maxlength="120"
          /><button :disabled="busy || query.trim().length < 2">
            {{ t("搜索") }}
          </button>
        </form>
        <p class="hint">{{ t("请输入至少两个字") }}</p>
        <RouterLink
          v-for="item in results"
          :key="`${item.kind}-${item.id}`"
          class="p-result"
          :to="item.path"
          ><span
            ><small>{{ t(item.kind) }}</small
            ><strong>{{ item.label }}</strong
            ><small>{{ item.detail }}</small></span
          ><MerchantIcon name="chevron-right"
        /></RouterLink>
        <p v-if="!busy && !results.length && query" class="empty-state">
          {{ t("暂无匹配结果") }}
        </p>
      </template>
      <template v-else-if="drawer === 'queue'"
        ><RouterLink
          v-for="item in queue"
          :key="item.path"
          :to="item.path"
          class="p-result"
          ><span>{{ t(item.label) }}</span
          ><strong>{{ item.count }}</strong
          ><MerchantIcon name="chevron-right" /></RouterLink
      ></template>
      <template v-else
        ><div class="p-account">
          <span class="p-avatar">{{ adminName.charAt(0).toUpperCase() }}</span>
          <h3>{{ adminName }}</h3>
          <p>{{ t("平台管理员") }}</p>
        </div>
        <button class="secondary" @click="logout">
          <MerchantIcon name="logout" />{{ t("退出登录") }}
        </button></template
      >
      <p v-if="busy" role="status" class="hint">{{ t("加载中…") }}</p>
      <p v-if="message" role="alert" class="error">{{ message }}</p>
    </PlatformDrawer>
  </div>
</template>
