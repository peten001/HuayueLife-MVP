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
  { path: '/platform/orders', label: '订单管理', icon: '单' },
  { path: '/platform/analytics', label: '营业数据', icon: '数' },
  { path: '/platform/recommendations', label: '分类推荐', icon: '荐' },
  { path: '/platform/users', label: '用户管理', icon: '客' },
  { path: '/platform/settings', label: '系统设置', icon: '设' },
];

const adminName = computed(() => admin?.username?.trim() || '平台管理员');
const adminInitial = computed(() => adminName.value.trim().charAt(0).toUpperCase() || '平');

const pageLabel = computed(() => {
  const path = route.path;
  if (path === '/platform/dashboard') return '总览';
  if (path.startsWith('/platform/merchants/')) return '商家详情';
  if (path === '/platform/merchants') return '商家管理';
  if (path === '/platform/orders') return '订单管理';
  if (path === '/platform/analytics') return '营业数据';
  if (path === '/platform/recommendations') return '分类推荐';
  if (path === '/platform/users') return '用户管理';
  if (path === '/platform/settings') return '系统设置';
  return '总览';
});

function isNavActive(path: string) {
  if (path === '/platform/merchants') {
    return route.path === path || route.path.startsWith('/platform/merchants/');
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
        <div class="platform-brand-main">华越优选</div>
        <div class="platform-brand-sub">平台后台</div>
      </div>

      <nav class="platform-nav">
        <RouterLink
          v-for="item in nav"
          :key="item.path"
          :to="item.path"
          class="platform-nav-item"
          :class="{ active: isNavActive(item.path) }"
        >
          <span class="platform-nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
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
        <div class="platform-breadcrumb">主页 / {{ pageLabel }}</div>

        <div class="platform-topbar-actions">
          <label class="platform-search" aria-label="全局搜索">
            <span class="platform-topbar-icon" aria-hidden="true">搜</span>
            <input type="text" placeholder="全局搜索…" readonly />
          </label>

          <button class="platform-icon-button" type="button" aria-label="通知">
            <span aria-hidden="true">铃</span>
          </button>
          <button class="platform-icon-button" type="button" aria-label="语言">
            <span aria-hidden="true">语</span>
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
              <p>账号由服务器环境变量配置</p>
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
            当前平台管理员由服务器配置，暂不支持在线修改账号和密码。如需修改，请联系服务器管理员更新
            <code>SUPER_ADMIN_USERNAME</code> 和 <code>SUPER_ADMIN_PASSWORD_HASH</code>。
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
