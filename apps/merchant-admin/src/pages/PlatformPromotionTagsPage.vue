<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createPlatformPromotionTag,
  disablePlatformPromotionTag,
  getPlatformPromotionTags,
  updatePlatformPromotionTag,
} from '@/api/platform';
import type { PlatformPromotionTag } from '@/types/api';

const items = ref<PlatformPromotionTag[]>([]);
const loading = ref(false);
const message = ref('');
const editingId = ref('');
const scopeOptions = [
  { value: 'OPERATIONAL', label: '平台运营' },
  { value: 'CUISINE', label: '菜系' },
  { value: 'SCENE', label: '场景' },
] as const;
const form = reactive({
  code: '',
  nameZh: '',
  nameVi: '',
  nameEn: '',
  iconUrl: '',
  iconText: '',
  color: '',
  description: '',
  scope: 'OPERATIONAL' as PlatformPromotionTag['scope'],
  sortOrder: 0,
  enabled: true,
});

onMounted(loadItems);

async function loadItems() {
  loading.value = true;
  message.value = '';
  try {
    items.value = await getPlatformPromotionTags();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  editingId.value = '';
  form.code = '';
  form.nameZh = '';
  form.nameVi = '';
  form.nameEn = '';
  form.iconUrl = '';
  form.iconText = '';
  form.color = '';
  form.description = '';
  form.scope = 'OPERATIONAL';
  form.sortOrder = 0;
  form.enabled = true;
}

function edit(item: PlatformPromotionTag) {
  editingId.value = item.id;
  form.code = item.code;
  form.nameZh = item.nameZh;
  form.nameVi = item.nameVi ?? '';
  form.nameEn = item.nameEn ?? '';
  form.iconUrl = item.iconUrl ?? '';
  form.iconText = item.iconText ?? '';
  form.color = item.color ?? '';
  form.description = item.description ?? '';
  form.scope = item.scope;
  form.sortOrder = item.sortOrder;
  form.enabled = item.enabled;
}

async function submit() {
  message.value = '';
  const payload = {
    code: form.code.trim(),
    nameZh: form.nameZh.trim(),
    nameVi: form.nameVi.trim() || undefined,
    nameEn: form.nameEn.trim() || undefined,
    iconUrl: form.iconUrl.trim() || undefined,
    iconText: form.iconText.trim() || undefined,
    color: form.color.trim() || undefined,
    description: form.description.trim() || undefined,
    scope: form.scope,
    sortOrder: form.sortOrder,
    enabled: form.enabled,
  };
  try {
    if (editingId.value) {
      await updatePlatformPromotionTag(editingId.value, payload);
      message.value = '标签已更新';
    } else {
      await createPlatformPromotionTag(payload);
      message.value = '标签已新增';
    }
    resetForm();
    await loadItems();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function scopeLabel(scope: PlatformPromotionTag['scope']) {
  return scopeOptions.find((item) => item.value === scope)?.label ?? scope;
}

async function disable(item: PlatformPromotionTag) {
  if (!window.confirm(`停用 ${item.nameZh}？`)) return;
  try {
    await disablePlatformPromotionTag(item.id);
    await loadItems();
  } catch (error) {
    message.value = errorMessage(error);
  }
}
</script>

<template>
  <PageHeader title="标签字典管理" description="分别维护平台运营标签，以及可在商家详情页展示的菜系与场景标签。" />
  <p v-if="message" class="message">{{ message }}</p>

  <form class="card form-grid" @submit.prevent="submit">
    <h2 class="span-2">{{ editingId ? '编辑标签' : '新增标签' }}</h2>
    <label>编码<input v-model="form.code" required maxlength="64" placeholder="HOT_FOOD" /></label>
    <label>中文名<input v-model="form.nameZh" required maxlength="80" /></label>
    <label>越南语名<input v-model="form.nameVi" maxlength="80" /></label>
    <label>英文名<input v-model="form.nameEn" maxlength="80" /></label>
    <label class="span-2">图标 URL<input v-model="form.iconUrl" maxlength="500" /></label>
    <label>图标文本<input v-model="form.iconText" maxlength="16" placeholder="🔥" /></label>
    <label>颜色<input v-model="form.color" maxlength="32" placeholder="#16a34a" /></label>
    <label class="span-2">描述<input v-model="form.description" maxlength="255" /></label>
    <label>用途
      <select v-model="form.scope">
        <option v-for="option in scopeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
    </label>
    <label>排序<input v-model.number="form.sortOrder" type="number" min="0" /></label>
    <label class="check"><input v-model="form.enabled" type="checkbox" />启用</label>
    <div class="form-actions span-2">
      <button class="secondary" type="button" @click="resetForm">清空</button>
      <button type="submit">{{ editingId ? '保存' : '新增' }}</button>
    </div>
  </form>

  <section class="card">
    <div class="platform-table-header">
      <h2>标签列表</h2>
      <button class="secondary" :disabled="loading" @click="loadItems">刷新</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>编码</th>
            <th>名称</th>
            <th>用途</th>
            <th>展示</th>
            <th>排序</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.code }}</td>
            <td>{{ item.nameZh }}<br /><small>{{ item.nameVi }} / {{ item.nameEn }}</small></td>
            <td>{{ scopeLabel(item.scope) }}</td>
            <td>
              <span :style="{ color: item.color || undefined }">{{ item.iconText || '•' }}</span>
              <small>{{ item.description || '-' }}</small>
            </td>
            <td>{{ item.sortOrder }}</td>
            <td>{{ item.enabled ? '启用' : '停用' }}</td>
            <td>
              <button class="small secondary" @click="edit(item)">编辑</button>
              <button class="small warning" :disabled="!item.enabled" @click="disable(item)">停用</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
@media (max-width: 760px) {
  input,
  select,
  button {
    min-height: 44px;
  }
}
</style>
