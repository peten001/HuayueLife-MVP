<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { clearPlatformAdmin, clearPlatformToken, getPlatformAdmin } from '@/utils/storage';

const router = useRouter();
const route = useRoute();
const admin = getPlatformAdmin();
const profileOpen = ref(false);

const nav: Array<{ path: string; label: string; icon: string }> = [
  { path: '/platform/dashboard', label: '总览', icon: '总' },
  { path: '/platform/merchants', label: '商家管理', icon: '商' },
  { path: '/platform/recommendations', label: '首页推荐', icon: '首' },
  { path: '/platform/orders', label: '订单管理', icon: '单' },
  { path: '/platform/analytics', label: '营业数据', icon: '数' },
  { path: '/platform/users', label: '用户管理', icon: '客' },
  { path: '/platform/settings', label: '系统设置', icon: '设' },
];
const merchantEditSections = [
  { key: 'profile', label: '基础资料' },
  { key: 'location', label: '地址与定位' },
  { key: 'images', label: '图片管理' },
  { key: 'visibility', label: '前台展示' },
  { key: 'hot', label: '热门推荐' },
  { key: 'capabilities', label: '能力开关' },
  { key: 'account', label: '商家账号' },
  { key: 'danger', label: '危险操作', danger: true },
];

const adminName = computed(() => admin?.username?.trim() || '平台管理员');
const adminInitial = computed(() => adminName.value.trim().charAt(0).toUpperCase() || '平');
const isMerchantDetailPage = computed(() => route.path.startsWith('/platform/merchants/'));
const activeMerchantEditSection = computed(() => route.hash.replace('#merchant-section-', '') || 'profile');
const breadcrumb = computed(() => {
  const path = route.path;
  if (path === '/platform/dashboard') return ['主页', '平台总览'];
  if (path.startsWith('/platform/merchants/')) return ['商家管理', '商家详情'];
  if (path === '/platform/merchants') return ['商家管理', '商家列表'];
  if (path === '/platform/merchant-types') return ['系统设置', '商家类型配置'];
  if (path === '/platform/promotion-tags') return ['系统设置', '推荐标签配置'];
  if (path === '/platform/orders') return ['订单管理', '订单管理'];
  if (path === '/platform/analytics') return ['营业数据', '营业数据'];
  if (path === '/platform/recommendations') return ['首页推荐', '首页推荐'];
  if (path === '/platform/users') return ['用户管理', '用户管理'];
  if (path === '/platform/settings') return ['系统设置', '系统设置'];
  return ['主页', '平台总览'];
});

function isNavActive(path: string) {
  if (path === '/platform/merchants') {
    return route.path.startsWith('/platform/merchants');
  }
  return route.path === path;
}

async function logout() {
  clearPlatformToken();
  clearPlatformAdmin();
  profileOpen.value = false;
  await router.push('/platform/login');
}
</script>

<template>
  <div class="app-shell platform-shell">
    <aside class="sidebar platform-sidebar">
      <div class="platform-branding">
        <span class="platform-brand-mark" aria-hidden="true">云</span>
        <div class="platform-brand-main">云桥 Life 平台后台</div>
        <div class="platform-brand-sub">平台运营中心</div>
      </div>

      <nav class="platform-nav">
        <template v-for="item in nav" :key="item.path">
          <RouterLink
            :to="item.path"
            class="platform-nav-item"
            :class="{ active: isNavActive(item.path) }"
          >
            <span class="platform-nav-icon" aria-hidden="true">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </RouterLink>

          <div v-if="item.path === '/platform/merchants' && isMerchantDetailPage" class="platform-sub-nav">
            <RouterLink
              v-for="section in merchantEditSections"
              :key="section.key"
              :to="{ path: route.path, hash: `#merchant-section-${section.key}` }"
              class="platform-sub-nav-item"
              :class="{
                'is-active': activeMerchantEditSection === section.key,
                'is-danger': section.danger,
              }"
            >
              {{ section.label }}
            </RouterLink>
          </div>
        </template>
      </nav>

      <button class="platform-profile-entry" type="button" @click="profileOpen = true">
        <span class="platform-profile-entry-icon" aria-hidden="true">☺</span>
        <span class="platform-profile-entry-text">
          <strong>个人中心</strong>
          <small>{{ adminName }}</small>
        </span>
      </button>
    </aside>

    <main class="content platform-content">
      <header class="platform-topbar">
        <div class="platform-topbar-left">
          <div class="platform-breadcrumb">
            <span>云桥 Life 平台后台</span>
            <span aria-hidden="true">/</span>
            <strong>{{ breadcrumb[1] }}</strong>
          </div>
        </div>

        <div class="platform-topbar-actions">
          <label class="platform-search" aria-label="全局搜索">
            <span class="platform-topbar-icon" aria-hidden="true">⌕</span>
            <input type="text" placeholder="搜索商家、订单、用户…" readonly />
          </label>

          <button class="platform-icon-button" type="button" aria-label="通知">
            <span aria-hidden="true">◉</span>
          </button>
          <button class="platform-icon-button" type="button" aria-label="语言">
            <span aria-hidden="true">◫</span>
          </button>

          <div class="platform-admin-chip">
            <span class="platform-admin-chip-name">{{ adminName }}</span>
            <span class="platform-admin-avatar">{{ adminInitial }}</span>
          </div>
        </div>
      </header>

      <section class="platform-page-body">
        <RouterView />
      </section>
    </main>

    <Teleport to="body">
      <div v-if="profileOpen" class="platform-modal-mask" @click.self="profileOpen = false">
        <div class="platform-modal">
          <div class="platform-modal-header">
            <div>
              <h2>个人中心</h2>
              <p>当前平台管理员信息</p>
            </div>
            <button class="platform-icon-button" type="button" aria-label="关闭" @click="profileOpen = false">
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          <div class="platform-profile-card">
            <div class="platform-profile-row">
              <span>当前账号</span>
              <strong>{{ adminName }}</strong>
            </div>
            <div class="platform-profile-row">
              <span>账号来源</span>
              <strong>服务器环境变量配置</strong>
            </div>
          </div>

          <p class="platform-profile-note">
            当前平台管理员由服务器配置，暂不支持在线修改账号和密码。
          </p>

          <div class="platform-modal-footer">
            <button class="secondary" type="button" @click="profileOpen = false">关闭</button>
            <button type="button" @click="logout">退出登录</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.platform-sub-nav {
  display: grid;
  gap: 4px;
  margin: 6px 0 8px 38px;
}

.platform-sidebar .platform-sub-nav .platform-sub-nav-item,
.platform-sidebar .platform-sub-nav .platform-sub-nav-item.router-link-active,
.platform-sidebar .platform-sub-nav .platform-sub-nav-item.router-link-exact-active {
  display: flex;
  align-items: center;
  width: auto;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  box-shadow: none;
}

.platform-sidebar .platform-sub-nav .platform-sub-nav-item:hover {
  background: #f3fbf5;
  color: #15803d;
}

.platform-sidebar .platform-sub-nav .platform-sub-nav-item.is-active {
  background: #e8f7ec;
  color: #15803d;
  font-weight: 700;
}

.platform-sidebar .platform-sub-nav .platform-sub-nav-item.is-danger,
.platform-sidebar .platform-sub-nav .platform-sub-nav-item.is-danger.router-link-active,
.platform-sidebar .platform-sub-nav .platform-sub-nav-item.is-danger.router-link-exact-active {
  background: transparent;
  color: #dc2626;
  font-weight: 600;
}

.platform-sidebar .platform-sub-nav .platform-sub-nav-item.is-danger:hover {
  background: #fff1f2;
  color: #dc2626;
}

.platform-sidebar .platform-sub-nav .platform-sub-nav-item.is-danger.is-active {
  background: #fff1f2;
  color: #dc2626;
  font-weight: 700;
}
</style>
