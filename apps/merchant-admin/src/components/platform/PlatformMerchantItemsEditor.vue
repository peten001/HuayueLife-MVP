<script setup lang="ts">
import { ref } from "vue";
import { uploadPlatformMerchantImage } from "@/api/platform";
import { errorMessage } from "@/api/http";
import { resolveMediaUrl } from "@/utils/media";
export type DisplayItem = {
  id?: string;
  clientKey?: string;
  nameZh: string;
  nameVi?: string | null;
  nameEn?: string | null;
  imageUrl?: string | null;
  sortOrder: number;
  isVisible: boolean;
  descriptionZh?: string | null;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  durationMinutes?: number | null;
  priceMode?: "INQUIRY" | "FIXED" | "FROM";
  amountVnd?: string | null;
  unit?: string | null;
};
const props = defineProps<{
  modelValue: DisplayItem[];
  restaurant: boolean;
  menuManaged?: boolean;
  title: string;
  menuCount?: number;
}>();
const emit = defineEmits<{
  "update:modelValue": [items: DisplayItem[]];
  busy: [value: boolean];
}>();
const message = ref("");
const uploading = ref(0);
const failedImages = ref(new Set<string>());
const failed = ref<{ item: DisplayItem; file: File }>();
function add() {
  const item: DisplayItem = {
    clientKey: crypto.randomUUID(),
    nameZh: "",
    nameVi: "",
    nameEn: "",
    imageUrl: "",
    sortOrder: props.modelValue.length,
    isVisible: true,
    ...(!props.restaurant
      ? {
          descriptionZh: "",
          descriptionVi: "",
          descriptionEn: "",
          priceMode: "INQUIRY" as const,
          amountVnd: null,
          durationMinutes: null,
          unit: "",
        }
      : {}),
  };
  emit("update:modelValue", [...props.modelValue, item]);
}
function update(item: DisplayItem, field: string, value: unknown) {
  emit(
    "update:modelValue",
    props.modelValue.map((row) =>
      row === item ? { ...row, [field]: value } : row,
    ),
  );
}
function price(item: DisplayItem, event: Event) {
  const priceMode = (event.target as HTMLSelectElement)
    .value as DisplayItem["priceMode"];
  emit(
    "update:modelValue",
    props.modelValue.map((row) =>
      row === item
        ? {
            ...row,
            priceMode,
            amountVnd: priceMode === "INQUIRY" ? null : row.amountVnd || "",
          }
        : row,
    ),
  );
}
function remove(item: DisplayItem) {
  emit(
    "update:modelValue",
    props.modelValue.filter((row) => row !== item),
  );
}
async function upload(item: DisplayItem, file: File) {
  uploading.value++;
  emit("busy", true);
  message.value = "";
  try {
    const result = await uploadPlatformMerchantImage(file);
    const current = props.modelValue.find((row) =>
      item.id ? row.id === item.id : row.clientKey === item.clientKey,
    );
    if (current) update(current, "imageUrl", result.imageUrl);
    failed.value = undefined;
  } catch (error) {
    message.value = errorMessage(error);
    failed.value = { item, file };
  } finally {
    uploading.value--;
    emit("busy", uploading.value > 0);
  }
}
function choose(item: DisplayItem, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (file) void upload(item, file);
}
</script>
<template>
  <article class="card">
    <div class="section-heading">
      <h2>{{ $pt(title) }}</h2>
      <button
        v-if="!menuManaged"
        type="button"
        class="secondary small"
        :disabled="!!uploading"
        @click="add"
      >
        {{ $pt("新增项目") }}
      </button>
    </div>
    <p class="hint">
      {{ $pt("项目与照片先保存为草稿，随商家资料统一更新。") }}
    </p>
    <p v-if="message" class="error" role="alert">
      {{ $pt(message)
      }}<button
        v-if="failed"
        class="secondary small"
        :disabled="!!uploading"
        @click="upload(failed.item, failed.file)"
      >
        {{ $pt("重试") }}
      </button>
    </p>
    <template v-if="menuManaged"
      ><p class="p-status-note">
        {{ $pt("招牌菜由商家菜单维护") }} · {{ $pt("当前公开菜品") }}
        {{ menuCount || 0 }} {{ $pt("个") }}
      </p>
      <details v-if="modelValue.length" class="p-display-item">
        <summary>
          {{ $pt("认领前的独立展示记录") }} · {{ modelValue.length }}
        </summary>
        <div class="p-display-item-body">
          <p class="hint">
            {{ $pt("这些记录仅在后台保留，不会替代商家菜单。") }}
          </p>
          <ul>
            <li v-for="item in modelValue" :key="item.id || item.clientKey">
              {{ item.nameZh || $pt("未命名项目") }}
              <a
                v-if="item.imageUrl"
                :href="resolveMediaUrl(item.imageUrl)"
                target="_blank"
                rel="noopener"
                >{{ $pt("查看") }}</a
              >
            </li>
          </ul>
        </div>
      </details></template
    >
    <template v-else
      ><p v-if="!modelValue.length" class="p-summary-note">
        {{ $pt("尚无展示项目，可按需添加。") }}
      </p>
      <details
        v-for="item in modelValue"
        :key="item.id || item.clientKey"
        class="p-display-item"
        :open="!item.id"
      >
        <summary>
          <span>{{ item.nameZh || $pt("未命名项目") }}</span
          ><small>{{ $pt(item.isVisible ? "展示" : "隐藏") }}</small>
        </summary>
        <div class="p-display-item-body">
          <div class="p-form-grid">
            <label
              >{{ $pt("中文名称")
              }}<input
                :value="item.nameZh"
                maxlength="120"
                @input="
                  update(
                    item,
                    'nameZh',
                    ($event.target as HTMLInputElement).value,
                  )
                " /></label
            ><label
              >{{ $pt("越南文名称")
              }}<input
                :value="item.nameVi"
                maxlength="120"
                @input="
                  update(
                    item,
                    'nameVi',
                    ($event.target as HTMLInputElement).value,
                  )
                " /></label
            ><label
              >{{ $pt("英文名称（选填）")
              }}<input
                :value="item.nameEn"
                maxlength="120"
                @input="
                  update(
                    item,
                    'nameEn',
                    ($event.target as HTMLInputElement).value,
                  )
                " /></label
            ><label
              >{{ $pt("排序")
              }}<input
                :value="item.sortOrder"
                type="number"
                min="0"
                @input="
                  update(
                    item,
                    'sortOrder',
                    Number(($event.target as HTMLInputElement).value),
                  )
                " /></label
            ><template v-if="!restaurant"
              ><label
                v-for="language in [
                  { key: 'descriptionZh', label: '中文规格/说明' },
                  { key: 'descriptionVi', label: '越文规格/说明' },
                  { key: 'descriptionEn', label: '英文规格/说明' },
                ]"
                :key="language.key"
                class="full"
                >{{ $pt(language.label)
                }}<textarea
                  :value="String(item[language.key as keyof DisplayItem] || '')"
                  maxlength="500"
                  @input="
                    update(
                      item,
                      language.key,
                      ($event.target as HTMLTextAreaElement).value,
                    )
                  "
                /></label
              ><label
                >{{ $pt("价格方式")
                }}<select
                  :value="item.priceMode"
                  :aria-label="$pt('价格方式')"
                  @change="price(item, $event)"
                >
                  <option value="INQUIRY">{{ $pt("询价") }}</option>
                  <option value="FIXED">{{ $pt("固定价") }}</option>
                  <option value="FROM">{{ $pt("起价") }}</option>
                </select></label
              ><label v-if="item.priceMode !== 'INQUIRY'"
                >{{ $pt("金额（VND）")
                }}<input
                  :value="item.amountVnd"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  @input="
                    update(
                      item,
                      'amountVnd',
                      ($event.target as HTMLInputElement).value,
                    )
                  " /></label
              ><label
                >{{ $pt("单位（选填）")
                }}<input
                  :value="item.unit"
                  maxlength="32"
                  @input="
                    update(
                      item,
                      'unit',
                      ($event.target as HTMLInputElement).value,
                    )
                  " /></label
              ><label
                >{{ $pt("时长（选填，分钟）")
                }}<input
                  :value="item.durationMinutes"
                  type="number"
                  min="1"
                  max="1440"
                  @input="
                    update(
                      item,
                      'durationMinutes',
                      ($event.target as HTMLInputElement).value
                        ? Number(($event.target as HTMLInputElement).value)
                        : null,
                    )
                  " /></label
            ></template>
          </div>
          <div class="p-inline" style="margin-top: 20px">
            <img
              v-if="item.imageUrl && !failedImages.has(item.imageUrl)"
              class="p-item-photo"
              :src="resolveMediaUrl(item.imageUrl)"
              :alt="item.nameZh"
              @error="failedImages.add(item.imageUrl!)"
            /><button
              v-else-if="item.imageUrl"
              type="button"
              class="secondary small"
              @click="failedImages.delete(item.imageUrl!)"
            >
              {{ $pt("图片暂不可用") }} · {{ $pt("重试") }}</button
            ><label class="p-upload-button"
              >{{ $pt(uploading ? "正在优化…" : "选择项目图片")
              }}<input
                type="file"
                accept="image/*"
                :disabled="!!uploading"
                @change="choose(item, $event)" /></label
            ><label class="p-inline"
              ><input
                :checked="item.isVisible"
                type="checkbox"
                @change="
                  update(
                    item,
                    'isVisible',
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />{{ $pt("展示") }}</label
            ><button
              type="button"
              class="secondary small"
              :disabled="!!uploading"
              @click="remove(item)"
            >
              {{ $pt("从草稿移除") }}
            </button>
          </div>
        </div>
      </details></template
    >
  </article>
</template>
