<script setup lang="ts">
import { clearToken } from '@/utils/storage';
import { useRouter } from 'vue-router';

const router = useRouter();
const nav = [
  ['/dashboard', '经营看板'],
  ['/orders', '订单管理'],
  ['/merchant/profile', '商家资料'],
  ['/merchant/business-settings', '营业设置'],
  ['/menu/categories', '分类管理'],
  ['/menu/products', '菜品管理'],
  ['/tables', '桌台管理'],
];

async function logout() {
  clearToken();
  await router.push('/login');
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">华越优选商家后台</div>
      <nav>
        <RouterLink v-for="[path, label] in nav" :key="path" :to="path">
          {{ label }}
        </RouterLink>
      </nav>
      <button class="secondary logout" @click="logout">退出登录</button>
    </aside>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
