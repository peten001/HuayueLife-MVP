<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { loginPlatform } from "@/api/platform";
import { errorMessage } from "@/api/http";
import { setPlatformAdmin, setPlatformToken } from "@/utils/storage";
import { usePlatformLocale } from "@/composables/usePlatformLocale";
const router = useRouter();
const { locale, setLocale, t } = usePlatformLocale();
const username = ref("");
const password = ref("");
const showPassword = ref(false);
const loading = ref(false);
const error = ref("");
watch(locale,()=>{document.title=`${t('登录工作台')} · YunQiao`;document.documentElement.lang=locale.value==='zh'?'zh-CN':locale.value;},{immediate:true});
async function submit() {
  loading.value = true;
  error.value = "";
  try {
    const result = await loginPlatform(username.value.trim(), password.value);
    setPlatformToken(result.accessToken);
    setPlatformAdmin(result.admin);
    await router.push("/platform/dashboard");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>
<template>
  <main class="p-login">
    <header>
      <a class="p-brand" href="/platform/login"
        ><img src="/yunqiao-mark.png" alt="" /><span>YunQiao</span></a
      ><select
        :value="locale"
        aria-label="Language"
        @change="
          setLocale(
            ($event.target as HTMLSelectElement).value as 'zh' | 'vi' | 'en',
          )
        "
      >
        <option value="zh">中文</option>
        <option value="vi">Tiếng Việt</option>
        <option value="en">English</option>
      </select>
    </header>
    <div class="p-login-main">
      <div class="p-login-intro">
        <span class="p-login-eyebrow">YunQiao</span>
        <h1>{{ t("管理有序，运营从容。") }}</h1>
        <p>{{ t("商家、内容、交易与数据，在一个工作台协同。") }}</p>
        <div class="p-login-index">
          <span>01</span>
          <div>
            <strong>{{ t("商家与内容") }}</strong
            ><small>{{ t("从资料完善到预览发布，每一步清楚可见。") }}</small>
          </div>
        </div>
        <div class="p-login-index">
          <span>02</span>
          <div>
            <strong>{{ t("经营与数据") }}</strong
            ><small>{{ t("关注真实订单，及时处理需要关注的事项。") }}</small>
          </div>
        </div>
      </div>
      <form class="p-login-form" @submit.prevent="submit">
        <h2>{{ t("欢迎回来") }}</h2>
        <p>{{ t("登录 YunQiao 平台工作台") }}</p>
        <label
          >{{ t("管理员账号")
          }}<input
            v-model="username"
            autocomplete="username"
            required
            autofocus
            maxlength="120"
            :placeholder="t('请输入账号')" /></label
        ><label
          >{{ t("密码") }}
          <div class="p-password">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              required
              minlength="8"
              :placeholder="t('请输入密码')"
            /><button
              type="button"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              {{ t(showPassword ? "隐藏" : "显示") }}
            </button>
          </div></label
        >
        <p v-if="error" class="p-login-error" role="alert">{{ error }}</p>
        <button class="p-login-submit" :disabled="loading">
          {{ t(loading ? "正在登录…" : "登录工作台") }}</button
        ><small>{{ t("仅限平台管理员使用") }}</small>
      </form>
    </div>
    <footer>YunQiao</footer>
  </main>
</template>
