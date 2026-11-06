<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import PlatformDrawer from "@/components/platform/PlatformDrawer.vue";
import {
  getPlatformMerchantDetail,
  getPlatformSettings,
  getPlatformCapabilities,
  updatePlatformMerchantCapabilities,
  openPlatformMerchantAccount,
  updatePlatformMerchantAccountPhone,
  resetPlatformMerchantPassword,
  disablePlatformMerchant,
  enablePlatformMerchant,
  deletePlatformMerchant,
} from "@/api/platform";
import type {
  PlatformMerchantDetailResponse,
  PlatformSettings,
  PlatformCapability,
} from "@/types/api";
import { errorMessage } from "@/api/http";
import { vietnamTime } from "@/utils/platform-format";
const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const data = ref<PlatformMerchantDetailResponse>();
const settings = ref<PlatformSettings>();
const capabilities = ref<PlatformCapability[]>([]);
const values = ref<Record<string, boolean>>({});
const busy = ref(false);
const message = ref("");
const confirm = ref("");
const phone = ref("");
const ordering = new Set([
  "onlineOrderEnabled",
  "pickupEnabled",
  "deliveryEnabled",
  "dineInEnabled",
  "qrOrderEnabled",
  "tableManagementEnabled",
  "voiceNotifyEnabled",
  "voiceBroadcastEnabled",
  "chatEnabled",
  "orderChatEnabled",
  "zaloReportEnabled",
]);
const groups = computed(() =>
  [...new Set(capabilities.value.map((c) => c.groupCode))].map((code) => ({
    code,
    name: capabilities.value.find((c) => c.groupCode === code)?.groupNameZh,
    items: capabilities.value.filter((c) => c.groupCode === code),
  })),
);
const changed = computed(() =>
  capabilities.value.some(
    (c) =>
      values.value[c.code] !==
      Boolean(
        data.value?.merchant.capabilities.find((v) => v.code === c.code)
          ?.isEnabled ?? c.defaultValue,
      ),
  ),
);
async function load() {
  busy.value = true;
  try {
    const [detail, config, items] = await Promise.all([
      getPlatformMerchantDetail(id),
      getPlatformSettings(),
      getPlatformCapabilities(),
    ]);
    data.value = detail;
    settings.value = config;
    capabilities.value = items.filter((c) => c.enabled);
    values.value = Object.fromEntries(
      capabilities.value.map((c) => [
        c.code,
        detail.merchant.capabilities.find((v) => v.code === c.code)
          ?.isEnabled ?? c.defaultValue,
      ]),
    );
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function save() {
  busy.value = true;
  message.value = "";
  try {
    await updatePlatformMerchantCapabilities(
      id,
      capabilities.value
        .filter(
          (c) =>
            settings.value?.platformOrderingEnabled || !ordering.has(c.code),
        )
        .map((c) => ({ code: c.code, isEnabled: values.value[c.code] })),
    );
    await load();
    message.value = "商家能力已保存，按平台总开关状态生效。";
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function action() {
  busy.value = true;
  message.value = "";
  try {
    if (confirm.value === "open") {
      await openPlatformMerchantAccount(id);
      message.value = "账号已开通，初始密码 12345678，首次登录须修改密码。";
    } else if (confirm.value === "phone") {
      await updatePlatformMerchantAccountPhone(id, phone.value);
      message.value = "登录手机号已更新。";
    } else if (confirm.value === "reset") {
      await resetPlatformMerchantPassword(id);
      message.value = "密码已重置为 12345678，首次登录须修改密码。";
    } else if (confirm.value === "disable") {
      await disablePlatformMerchant(id);
      message.value = "商家及账号已停用。";
    } else if (confirm.value === "enable") {
      await enablePlatformMerchant(id);
      message.value = "商家已启用。";
    } else if (confirm.value === "trash") {
      await deletePlatformMerchant(id);
      confirm.value = "";
      await router.push("/platform/merchants");
      return;
    }
    confirm.value = "";
    await load();
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section>
    <PageHeader
      :title="$pt('经营能力与账号')"
      :description="
        data ? `${data.merchant.nameZh} · 商家编号 ${id}` : '读取商家配置…'
      "
      ><RouterLink
        class="button-link secondary"
        :to="`/platform/merchants/${id}`"
        >{{ $pt("返回商家资料") }}</RouterLink
      ></PageHeader
    >
    <p v-if="message" class="p-status-note" role="status">{{ $pt(message) }}</p>
    <template v-if="data"
      ><p class="p-status-note">
        {{ $pt("平台经营总开关")
        }}{{
          settings?.platformOrderingEnabled ? $pt("已开启") : $pt("已关闭")
        }}。{{
          settings?.platformOrderingEnabled
            ? $pt("每家商家按下方独立设置运行。")
            : $pt(
                "经营开关暂不可修改，已保存的商家选择仍保留；平台总开关打开后按原设置生效。",
              )
        }}<RouterLink to="/platform/settings">{{
          $pt("查看平台总控 →")
        }}</RouterLink>
      </p>
      <div class="p-split">
        <div>
          <article v-for="group in groups" :key="group.code" class="card">
            <h2>{{ group.name }}</h2>
            <div
              v-for="item in group.items"
              :key="item.code"
              class="p-capability-row"
            >
              <span
                ><strong>{{ item.nameZh }}</strong
                ><small>{{ item.nameVi }}</small
                ><small
                  v-if="
                    !settings?.platformOrderingEnabled &&
                    ordering.has(item.code)
                  "
                  >{{ $pt("平台总控已关闭 · 保留商家设置") }}</small
                ></span
              ><button
                role="switch"
                :aria-label="item.nameZh"
                :aria-checked="values[item.code]"
                class="p-switch"
                :class="{ on: values[item.code] }"
                :disabled="
                  busy ||
                  (!settings?.platformOrderingEnabled &&
                    ordering.has(item.code))
                "
                @click="values[item.code] = !values[item.code]"
              >
                <i />
              </button>
            </div>
          </article>
          <article class="card">
            <h2>{{ $pt("门店展示内容") }}</h2>
            <p class="hint">
              {{ $pt("照片与展示项目在商家资料页统一保存草稿和发布。") }}
            </p>
            <RouterLink :to="`/platform/merchants/${id}`"
              >{{ $pt("返回商家资料") }} →</RouterLink
            >
          </article>
        </div>
        <div>
          <article class="card">
            <h2>{{ $pt("商家账号") }}</h2>
            <dl class="detail-list">
              <dt>{{ $pt("开通状态") }}</dt>
              <dd>
                {{
                  data.merchant.claimStatus === "CLAIMED"
                    ? $pt("已开通")
                    : $pt("尚未开通")
                }}
              </dd>
              <dt>{{ $pt("登录手机号") }}</dt>
              <dd>{{ data.merchant.account || "—" }}</dd>
              <dt>{{ $pt("经营状态") }}</dt>
              <dd>
                {{
                  data.merchant.status === "DISABLED"
                    ? $pt("已停用")
                    : data.merchant.status === "PENDING"
                      ? $pt("待完善")
                      : $pt("正常")
                }}
              </dd>
            </dl>
            <div class="p-inline">
              <button
                v-if="data.merchant.claimStatus === 'UNCLAIMED'"
                :disabled="busy"
                @click="confirm = 'open'"
              >
                {{ $pt("开通账号") }}</button
              ><template v-else
                ><button
                  class="secondary"
                  :disabled="busy"
                  @click="
                    phone = '';
                    confirm = 'phone';
                  "
                >
                  {{ $pt("更换手机号") }}</button
                ><button
                  class="secondary"
                  :disabled="busy"
                  @click="confirm = 'reset'"
                >
                  {{ $pt("重置密码") }}
                </button></template
              >
            </div>
          </article>
          <article class="card">
            <h2>{{ $pt("打印状态") }}</h2>
            <dl class="detail-list">
              <dt>{{ $pt("配置状态") }}</dt>
              <dd>
                {{
                  data.printingSummary.configurationState === "CONFIGURED"
                    ? $pt("已配置")
                    : data.printingSummary.configurationState === "DISABLED"
                      ? $pt("未开通")
                      : $pt("尚未配置")
                }}
              </dd>
              <dt>{{ $pt("连接状态") }}</dt>
              <dd>
                {{
                  data.printingSummary.connectionState === "CONNECTED"
                    ? $pt("已连接")
                    : data.printingSummary.connectionState === "UNKNOWN"
                      ? $pt("暂无报告")
                      : data.printingSummary.connectionState === "OFFLINE"
                        ? $pt("离线")
                        : $pt("待连接")
                }}
              </dd>
              <dt>{{ $pt("上次报告") }}</dt>
              <dd>
                {{
                  data.printingSummary.lastReportedAt
                    ? vietnamTime(data.printingSummary.lastReportedAt)
                    : "—"
                }}
              </dd>
            </dl>
          </article>
          <article class="card">
            <h2>{{ $pt("账号与停用操作") }}</h2>
            <p class="hint">
              {{
                $pt("移入回收站后保留历史资料并停用账号。恢复后先保持隐藏。")
              }}
            </p>
            <div class="p-inline">
              <button
                class="secondary"
                :disabled="busy"
                @click="
                  confirm =
                    data.merchant.status === 'DISABLED' ? 'enable' : 'disable'
                "
              >
                {{
                  data.merchant.status === "DISABLED"
                    ? $pt("启用商家")
                    : $pt("停用商家")
                }}</button
              ><button
                class="secondary"
                :disabled="busy"
                @click="confirm = 'trash'"
              >
                {{ $pt("移入回收站") }}
              </button>
            </div>
          </article>
        </div>
      </div>
      <div class="p-sticky-actions">
        <span>{{
          changed ? $pt("有未保存的能力设置") : $pt("能力设置已保存")
        }}</span
        ><button :disabled="busy || !changed" @click="save">
          {{ $pt("保存能力设置") }}
        </button>
      </div></template
    ><PlatformDrawer
      :open="!!confirm"
      :title="confirm === 'phone' ? '更换登录手机号' : '确认商家操作'"
      @close="confirm = ''"
      ><p>
        {{
          confirm === "open"
            ? $pt(
                "将为这家商家开通后台账号，初始密码 12345678，首次登录须修改。",
              )
            : confirm === "reset"
              ? $pt("将重置为初始密码 12345678，并要求下次登录修改。")
              : confirm === "disable"
                ? $pt("停用后商家账号将无法登录。")
                : confirm === "enable"
                  ? $pt("将重新启用商家与账号，展示状态保持现有设置。")
                  : confirm === "trash"
                    ? $pt("将停止展示并停用账号，可在回收站恢复。")
                    : $pt("请填写新的登录手机号，不改变对外联系电话。")
        }}
      </p>
      <input
        v-if="confirm === 'phone'"
        v-model="phone"
        type="tel"
        inputmode="numeric"
        maxlength="15"
        :placeholder="$pt('新的登录手机号')"
        :aria-label="$pt('新的登录手机号')"
      /><template #footer
        ><button
          :disabled="busy || (confirm === 'phone' && !/^\d{8,15}$/.test(phone))"
          @click="action"
        >
          {{ busy ? $pt("正在处理…") : $pt("确认执行") }}
        </button></template
      ></PlatformDrawer
    >
  </section>
</template>
