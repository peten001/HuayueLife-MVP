<script setup lang="ts">
import { onMounted, ref } from "vue";
import PageHeader from "@/components/PageHeader.vue";
import {
  exploreRequest,
  getPlatformSettings,
  updatePlatformSettings,
} from "@/api/platform";
import type { PlatformSettings } from "@/types/api";
import { errorMessage } from "@/api/http";
import { vietnamTime } from "@/utils/platform-format";
const settings = ref<PlatformSettings>();
const saving = ref(false);
const message = ref("");
const checking = ref(false);
const health = ref<{ api: string; database: string; checkedAt: string }>();
const diagnosticError = ref("");
async function load() {
  try {
    settings.value = await getPlatformSettings();
  } catch (e) {
    message.value = errorMessage(e);
  }
}
async function toggle() {
  if (!settings.value || saving.value || settings.value.readOnly) return;
  saving.value = true;
  message.value = "";
  try {
    settings.value = await updatePlatformSettings({
      platformOrderingEnabled: !settings.value.platformOrderingEnabled,
    });
    message.value = settings.value.platformOrderingEnabled
      ? "已开启平台经营能力，三项功能按各商家原有配置恢复。"
      : "已关闭全平台扫码点餐、到店自取和商家配送，商家原有配置已保留。";
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
async function check() {
  checking.value = true;
  diagnosticError.value = "";
  try {
    health.value = await exploreRequest("get", "/platform/workbench/health");
  } catch (e) {
    health.value = undefined;
    diagnosticError.value = errorMessage(e);
  } finally {
    checking.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section>
    <PageHeader
      :title="$pt('平台设置')"
      :description="$pt('管理平台经营总控，查看诊断结果与统一规则。')"
    />
    <p v-if="message" class="p-status-note" role="status">{{ $pt(message) }}</p>
    <div class="p-split">
      <div>
        <article class="card">
          <div class="section-heading">
            <h2>{{ $pt("平台经营总开关") }}</h2>
            <span
              class="badge"
              :class="settings?.platformOrderingEnabled ? 'success' : 'muted'"
              >{{
                settings
                  ? settings.platformOrderingEnabled
                    ? $pt("已开启")
                    : $pt("已关闭")
                  : $pt("未读取")
              }}</span
            >
          </div>
          <p class="p-settings-copy">
            {{ $pt("一键控制全平台所有商家的扫码点餐、到店自取和商家配送。") }}
          </p>
          <ul class="p-ordering-scope" :aria-label="$pt('总开关控制范围')">
            <li
              v-for="capability in ['扫码点餐', '到店自取', '商家配送']"
              :key="capability"
            >
              <strong>{{ $pt(capability) }}</strong>
              <span>{{
                $pt(
                  settings
                    ? settings.platformOrderingEnabled
                      ? "随商家设置开放"
                      : "平台已关闭"
                    : "未读取",
                )
              }}</span>
            </li>
          </ul>
          <div class="p-settings-switch">
            <span
              ><strong>{{ $pt("全平台经营能力") }}</strong
              ><small>{{
                $pt("关闭后，以上三项功能在全平台统一停用")
              }}</small></span
            ><button
              role="switch"
              :aria-checked="!!settings?.platformOrderingEnabled"
              :disabled="!settings || saving || settings.readOnly"
              :aria-label="$pt('平台经营总开关')"
              @click="toggle"
            >
              {{
                $pt(
                  saving
                    ? "正在保存…"
                    : !settings
                      ? "加载中…"
                      : settings.platformOrderingEnabled
                        ? "一键关闭经营能力"
                        : "一键开启经营能力",
                )
              }}
            </button>
          </div>
          <p class="p-status-note">
            {{
              $pt(
                "总开关关闭时保留每家商家的原有配置，重新开启后按原配置恢复。",
              )
            }}
          </p>
          <RouterLink to="/platform/merchants">{{
            $pt("前往商家能力设置 →")
          }}</RouterLink>
        </article>
        <article class="card">
          <h2>{{ $pt("统计与资料规则") }}</h2>
          <dl class="detail-list">
            <dt>{{ $pt("统计时区") }}</dt>
            <dd>{{ $pt("越南时间 · UTC+7") }}</dd>
            <dt>{{ $pt("主要金额指标") }}</dt>
            <dd>{{ $pt("已完成订单额，按订单记录与下单日期统计") }}</dd>
            <dt>{{ $pt("下单数") }}</dt>
            <dd>{{ $pt("含取消订单，排除作废单；进行中与取消金额另列") }}</dd>
            <dt>{{ $pt("商家公开资料") }}</dt>
            <dd>{{ $pt("中越双语与行业清单齐全后发布，英文选填") }}</dd>
            <dt>{{ $pt("图片处理") }}</dt>
            <dd>
              {{
                $pt("每张源图最多 20MB，自动优化，不永久保留原图；相册不限张数")
              }}
            </dd>
          </dl>
        </article>
      </div>
      <div>
        <article class="card">
          <div class="section-heading">
            <h2>{{ $pt("运行诊断") }}</h2>
            <button class="secondary small" :disabled="checking" @click="check">
              {{ checking ? $pt("正在检测…") : $pt("立即检测") }}
            </button>
          </div>
          <p class="hint">{{ $pt("检测结果仅代表本次请求时刻。") }}</p>
          <dl class="detail-list">
            <dt>{{ $pt("API 连通性") }}</dt>
            <dd>
              <span class="badge" :class="health ? 'success' : 'muted'">{{
                health
                  ? $pt("正常")
                  : diagnosticError
                    ? $pt("检测失败")
                    : $pt("尚未检测")
              }}</span>
            </dd>
            <dt>{{ $pt("数据库连接") }}</dt>
            <dd>
              <span class="badge" :class="health ? 'success' : 'muted'">{{
                health
                  ? $pt("正常")
                  : diagnosticError
                    ? $pt("无法确认")
                    : $pt("尚未检测")
              }}</span>
            </dd>
            <dt>{{ $pt("检测时间") }}</dt>
            <dd>{{ health ? vietnamTime(health.checkedAt) : "—" }}</dd>
          </dl>
          <p v-if="diagnosticError" class="error" role="alert">
            {{ diagnosticError }}
          </p>
        </article>
        <article class="card">
          <h2>{{ $pt("管理入口") }}</h2>
          <RouterLink class="p-result" to="/platform/merchant-types"
            ><span>{{ $pt("行业与默认能力") }}</span
            ><span>→</span></RouterLink
          ><RouterLink class="p-result" to="/platform/promotion-tags"
            ><span>{{ $pt("公共标签库") }}</span
            ><span>→</span></RouterLink
          ><RouterLink class="p-result" to="/platform/merchants/trash"
            ><span>{{ $pt("商家回收站") }}</span
            ><span>→</span></RouterLink
          >
        </article>
      </div>
    </div>
  </section>
</template>
