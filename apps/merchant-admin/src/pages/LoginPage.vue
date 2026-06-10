<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import { login } from '@/api/merchant';
import { setToken } from '@/utils/storage';

const router = useRouter();
const username = ref('owner');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  loading.value = true;
  error.value = '';
  try {
    const result = await login(username.value, password.value);
    setToken(result.accessToken);
    await router.push('/');
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <form class="card login-card" @submit.prevent="submit">
      <h1>商家后台登录</h1>
      <label>账号<input v-model="username" required /></label>
      <label>密码<input v-model="password" type="password" required minlength="8" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <button :disabled="loading">{{ loading ? '登录中...' : '登录' }}</button>
    </form>
  </main>
</template>
