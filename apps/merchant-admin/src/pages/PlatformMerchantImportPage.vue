<script setup lang="ts">
import { computed, ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import PlatformDrawer from "@/components/platform/PlatformDrawer.vue";
import {
  exploreRequest,
  previewPlatformMerchantImport,
  confirmPlatformMerchantImport,
  downloadPlatformMerchantImportTemplate,
} from "@/api/platform";
import type {
  PlatformMerchantImportPreviewResponse,
  PlatformMerchantImportConfirmResponse,
  PlatformMerchantImportRow,
} from "@/types/api";
import { errorMessage } from "@/api/http";
const preview = ref<
  PlatformMerchantImportPreviewResponse & { columns?: string[] }
>();
const result = ref<PlatformMerchantImportConfirmResponse>();
const busy = ref(false);
const message = ref("");
const step = ref(1);
const fileName = ref("");
const selected = ref<number[]>([]);
const mapping = ref<Record<string, string>>({});
const editing = ref<PlatformMerchantImportRow>();
const fields = [
  ["nameZh", "中文店名"],
  ["province", "城市 / 省"],
  ["nameVi", "越南文店名"],
  ["nameEn", "英文店名（选填）"],
  ["businessType", "行业编码"],
  ["contactName", "联系人"],
  ["contactPhone", "联系电话"],
  ["addressZh", "中文地址"],
  ["latitude", "纬度"],
  ["longitude", "经度"],
  ["coverPath", "封面路径（ZIP）"],
  ["营业时间", "营业时间"],
] as const;
const duplicates = (row: PlatformMerchantImportRow) =>
  row.warnings.some((w) => w.includes("重复") || w.includes("已存在"));
const columns = computed(
  () =>
    preview.value?.columns ||
    Object.keys(preview.value?.rows[0]?.rawData || {}),
);
async function template() {
  busy.value = true;
  try {
    const blob = await downloadPlatformMerchantImportTemplate();
    download(blob, "YunQiao-商家导入模板.xlsx");
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = true;
  message.value = "";
  try {
    if (!/\.(xlsx|zip)$/i.test(file.name))
      throw new Error("请选择 XLSX 或 ZIP 文件");
    preview.value = await previewPlatformMerchantImport(file);
    fileName.value = file.name;
    mapping.value = Object.fromEntries(
      fields.map(([field, label]) => [
        field,
        columns.value.includes(field)
          ? field
          : columns.value.includes(label)
            ? label
            : "",
      ]),
    );
    step.value = 2;
    result.value = undefined;
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
    (event.target as HTMLInputElement).value = "";
  }
}
async function checkRows(withEdits = false) {
  if (!preview.value) return;
  busy.value = true;
  message.value = "";
  try {
    preview.value = await exploreRequest(
      "post",
      "/platform/merchants/import-revise",
      {
        sessionId: preview.value.sessionId,
        mapping: mapping.value,
        ...(withEdits
          ? {
              edits: preview.value.rows.map((row) => ({
                rowNumber: row.rowNumber,
                rawData: row.rawData,
              })),
            }
          : {}),
      },
    );
    selected.value = preview
      .value!.rows.filter((row) => row.status !== "ERROR" && !duplicates(row))
      .map((row) => row.rowNumber);
    step.value = 3;
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function confirm(retry = false) {
  if (!preview.value) return;
  const rowNumbers = retry
    ? result.value?.failedRows.map((row) => row.rowNumber)
    : selected.value;
  if (!rowNumbers?.length) return;
  busy.value = true;
  message.value = "";
  try {
    result.value = await confirmPlatformMerchantImport(
      preview.value.sessionId,
      rowNumbers,
    );
    step.value = 4;
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
function editRow(row: PlatformMerchantImportRow) {
  editing.value = JSON.parse(JSON.stringify(row));
}
async function saveRow() {
  if (!preview.value || !editing.value) return;
  const index = preview.value.rows.findIndex(
    (row) => row.rowNumber === editing.value?.rowNumber,
  );
  preview.value.rows[index] = editing.value;
  editing.value = undefined;
  await checkRows(true);
}
function errorReport() {
  if (!preview.value) return;
  const rows = [
    ["行号", "中文店名", "错误", "警告"],
    ...preview.value.rows
      .filter((row) => row.errors.length || row.warnings.length)
      .map((row) => [
        String(row.rowNumber),
        row.rawData.nameZh || "",
        row.errors.join("；"),
        row.warnings.join("；"),
      ]),
  ];
  download(
    new Blob(
      [
        "\uFEFF" +
          rows
            .map((row) =>
              row.map((v) => '"' + v.replace(/"/g, '""') + '"').join(","),
            )
            .join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    ),
    "YunQiao-导入核对.csv",
  );
}
onBeforeRouteLeave(() => {
  if (busy.value) {
    message.value = "导入正在处理，请等待本次操作完成。";
    return false;
  }
  return true;
});
</script>
<template>
  <section>
    <PageHeader
      :title="$pt('批量导入商家')"
      :description="
        $pt('映射列、逐行核对，再保存为隐藏草稿；疑似重复商家默认跳过。')
      "
      ><RouterLink class="button-link secondary" to="/platform/merchants">{{
        $pt("返回商家列表")
      }}</RouterLink></PageHeader
    >
    <ol class="p-import-steps">
      <li
        v-for="(label, index) in ['上传文件', '映射列', '核对数据', '导入结果']"
        :key="label"
        :class="{ active: step === index + 1, done: step > index + 1 }"
      >
        <span>{{ index + 1 }}</span
        >{{ label }}
      </li>
    </ol>
    <p v-if="message" class="error" role="alert">{{ $pt(message) }}</p>
    <article v-if="step === 1" class="card">
      <h2>{{ $pt("准备商家资料") }}</h2>
      <p class="hint">
        {{
          $pt(
            "仅店名与城市必填，其余资料可在草稿中补齐。支持 XLSX，或包含 XLSX 与照片的 ZIP。照片每张最多 20MB，上传后自动优化且不永久保留原图。",
          )
        }}
      </p>
      <div class="p-import-drop">
        <h3>{{ $pt("选择导入文件") }}</h3>
        <p>{{ $pt("导入包最多 50MB · 照片使用 ZIP 内相对路径") }}</p>
        <label class="p-upload-button"
          >{{ busy ? $pt("正在预检查…") : $pt("选择 XLSX / ZIP")
          }}<input
            type="file"
            accept=".xlsx,.zip"
            :disabled="busy"
            @change="upload"
        /></label>
      </div>
      <button class="secondary" :disabled="busy" @click="template">
        {{ $pt("下载标准模板") }}
      </button>
    </article>
    <article v-if="step === 2 && preview" class="card">
      <div class="section-heading">
        <h2>{{ $pt("确认列对应关系") }}</h2>
        <span class="p-muted"
          >{{ fileName }} · {{ preview.totalRows }}{{ $pt("行") }}</span
        >
      </div>
      <div class="p-form-grid">
        <label v-for="field in fields" :key="field[0]"
          >{{ $pt(field[1])
          }}{{ ["nameZh", "province"].includes(field[0]) ? " *" : ""
          }}<select v-model="mapping[field[0]]">
            <option value="">{{ $pt("未对应 / 留空") }}</option>
            <option v-for="column in columns" :key="column" :value="column">
              {{ column }}
            </option>
          </select></label
        >
      </div>
      <div class="p-inline" style="margin-top: 28px">
        <button
          :disabled="busy || !mapping.nameZh || !mapping.province"
          @click="checkRows()"
        >
          {{ busy ? $pt("正在核对…") : $pt("确认映射并核对") }}</button
        ><button class="secondary" :disabled="busy" @click="step = 1">
          {{ $pt("重新选择文件") }}
        </button>
      </div>
    </article>
    <article v-if="step === 3 && preview" class="card">
      <div class="section-heading">
        <h2>{{ $pt("逐行核对") }}</h2>
        <button class="secondary small" @click="errorReport">
          {{ $pt("导出问题清单") }}
        </button>
      </div>
      <p class="p-status-note">
        {{
          $pt(
            "已默认跳过疑似重复。可编辑错误行后重新核对；确认需要新建的重复行，请手动勾选。不会覆盖现有商家。",
          )
        }}
      </p>
      <p class="p-muted">
        {{ $pt("共") }}{{ preview.totalRows }}{{ $pt("行 · 已选择")
        }}{{ selected.length }}{{ $pt("行 · 错误") }}{{ preview.invalidRows
        }}{{ $pt("行") }}
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ $pt("选择") }}</th>
              <th>{{ $pt("行号") }}</th>
              <th>{{ $pt("商家") }}</th>
              <th>{{ $pt("城市") }}</th>
              <th>{{ $pt("联系电话") }}</th>
              <th>{{ $pt("核对结果") }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in preview.rows" :key="row.rowNumber">
              <td>
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="row.rowNumber"
                  :disabled="row.status === 'ERROR'"
                  :aria-label="`选择第${row.rowNumber}行`"
                />
              </td>
              <td>{{ row.rowNumber }}</td>
              <td>
                {{
                  row.normalizedData?.nameZh ||
                  row.rawData.nameZh ||
                  $pt("待填写")
                }}
              </td>
              <td>
                {{
                  row.normalizedData?.province ||
                  row.rawData.province ||
                  $pt("待填写")
                }}
              </td>
              <td>{{ row.rawData.contactPhone || $pt("待补充") }}</td>
              <td>
                <span
                  class="badge"
                  :class="
                    row.status === 'ERROR'
                      ? 'danger'
                      : duplicates(row)
                        ? 'warning'
                        : 'muted'
                  "
                  >{{
                    row.status === "ERROR"
                      ? $pt("需修正")
                      : duplicates(row)
                        ? $pt("疑似重复 · 已默认跳过")
                        : row.status === "WARNING"
                          ? $pt("有提醒")
                          : $pt("可导入")
                  }}</span
                ><small
                  v-for="error in row.errors"
                  :key="error"
                  class="p-cell-sub"
                  >{{ error }}</small
                ><small
                  v-for="warning in row.warnings"
                  :key="warning"
                  class="p-cell-sub"
                  >{{ warning }}</small
                >
              </td>
              <td>
                <button class="p-table-action" @click="editRow(row)">
                  {{ $pt("编辑行") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="p-sticky-actions">
        <span>{{ $pt("导入后保持隐藏，完善资料后再发布") }}</span
        ><button class="secondary" :disabled="busy" @click="step = 2">
          {{ $pt("返回映射") }}</button
        ><button :disabled="busy || !selected.length" @click="confirm()">
          {{ busy ? $pt("正在导入…") : `导入 ${selected.length} 行草稿` }}
        </button>
      </div>
    </article>
    <article v-if="step === 4 && result" class="card">
      <h2>{{ $pt("导入完成") }}</h2>
      <p>
        {{ $pt("已保存") }}{{ result.importedCount }}{{ $pt("家商家，失败")
        }}{{ result.failedCount }}{{ $pt("行。") }}
      </p>
      <p class="p-status-note">
        {{
          $pt(
            "新商家均为隐藏草稿。补齐中越文、照片、定位与行业资料后，再点击“保存并更新”。",
          )
        }}
      </p>
      <div
        v-for="id in result.createdMerchantIds"
        :key="id"
        class="p-inline"
        style="padding: 12px 0"
      >
        <span>{{ $pt("商家编号") }}{{ id }}</span
        ><RouterLink :to="`/platform/merchants/${id}`">{{
          $pt("继续完善 →")
        }}</RouterLink>
      </div>
      <ul>
        <li v-for="row in result.failedRows" :key="row.rowNumber">
          {{ $pt("第") }}{{ row.rowNumber }}{{ $pt("行：")
          }}{{ row.errors.join("；") }}
        </li>
      </ul>
      <div class="p-inline">
        <button
          v-if="result.failedRows.length"
          :disabled="busy"
          @click="confirm(true)"
        >
          {{ $pt("仅重试失败行") }}</button
        ><button
          class="secondary"
          @click="
            step = 1;
            preview = undefined;
            result = undefined;
          "
        >
          {{ $pt("导入下一个文件") }}</button
        ><RouterLink to="/platform/merchants">{{
          $pt("查看商家列表 →")
        }}</RouterLink>
      </div>
    </article>
    <PlatformDrawer
      :open="!!editing"
      :title="$pt('修正导入行')"
      @close="editing = undefined"
      ><div v-if="editing" class="p-import-edit">
        <p class="hint">
          {{ $pt("第") }}{{ editing.rowNumber
          }}{{ $pt("行 · 保存后重新核对。") }}
        </p>
        <label v-for="field in fields" :key="field[0]"
          >{{ $pt(field[1]) }}<input v-model="editing.rawData[field[0]]"
        /></label>
      </div>
      <template #footer
        ><button :disabled="busy" @click="saveRow">
          {{ $pt("保存并重新核对") }}
        </button></template
      ></PlatformDrawer
    >
  </section>
</template>
