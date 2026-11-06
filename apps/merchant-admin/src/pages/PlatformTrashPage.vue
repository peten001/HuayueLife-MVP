<script setup lang="ts">
import { onMounted, ref } from "vue";
import PageHeader from "@/components/PageHeader.vue";
import { exploreRequest } from "@/api/platform";
import { errorMessage } from "@/api/http";
import { vietnamTime } from "@/utils/platform-format";
const rows = ref<
  Array<{ id: string; nameZh: string; city: string; updatedAt: string }>
>([]);
const busy = ref("");
const message = ref("");
async function load() {
  try {
    rows.value = (
      await exploreRequest<{ items: typeof rows.value }>(
        "get",
        "/platform/workbench/trash",
      )
    ).items;
  } catch (e) {
    message.value = errorMessage(e);
  }
}
async function restore(id: string) {
  busy.value = id;
  message.value = "";
  try {
    await exploreRequest("post", `/platform/workbench/trash/${id}/restore`);
    message.value = "商家已恢复并保持隐藏，商家账号仍为停用状态。";
    await load();
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = "";
  }
}
onMounted(load);
</script>
<template>
  <section>
    <PageHeader
      :title="$pt('商家回收站')"
      :description="$pt('恢复后先保持隐藏，核对资料与经营能力后再发布。')"
      ><RouterLink class="button-link secondary" to="/platform/merchants">{{
        $pt("返回商家列表")
      }}</RouterLink></PageHeader
    >
    <p v-if="message" class="p-status-note" role="status">{{ $pt(message) }}</p>
    <article class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ $pt("商家") }}</th>
              <th>{{ $pt("城市") }}</th>
              <th>{{ $pt("移入时间") }}</th>
              <th>{{ $pt("恢复说明") }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ row.nameZh }}</td>
              <td>{{ row.city }}</td>
              <td>{{ vietnamTime(row.updatedAt) }}</td>
              <td>{{ $pt("恢复资料 · 保持隐藏 · 账号停用") }}</td>
              <td>
                <button
                  class="secondary small"
                  :disabled="!!busy"
                  @click="restore(row.id)"
                >
                  {{ busy === row.id ? $pt("正在恢复…") : $pt("恢复商家") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!rows.length" class="empty-state">{{ $pt("回收站暂无商家") }}</p>
    </article>
  </section>
</template>
