<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createPlatformPromotionTag,
  deletePlatformPromotionTag,
  getPlatformPromotionTags,
  updatePlatformPromotionTag,
} from '@/api/platform';
import type { PlatformPromotionTag } from '@/types/api';

const items = ref<PlatformPromotionTag[]>([]);
const loading = ref(false);
const saving = ref(false);
const deletingId = ref('');
const message = ref('');
const messageIsSuccess = computed(() => /标签已(?:更新|新增|删除)/.test(message.value));
const editingId = ref('');
const tagForm = ref<HTMLFormElement | null>(null);
const nameZhInput = ref<HTMLInputElement | null>(null);
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
const editingItem = computed(() => items.value.find((item) => item.id === editingId.value) ?? null);
const scopeLocked = computed(() => Boolean(editingItem.value));
const tagGroups = computed(() => scopeOptions.map((option) => ({
  ...option,
  items: items.value.filter((item) => item.scope === option.value),
})));

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
  void nextTick(() => {
    tagForm.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    nameZhInput.value?.focus({ preventScroll: true });
  });
}

async function submit() {
  if (saving.value) return;
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
    saving.value = true;
    const successMessage = editingId.value ? '标签已更新' : '标签已新增';
    if (editingId.value) {
      await updatePlatformPromotionTag(editingId.value, payload);
    } else {
      await createPlatformPromotionTag(payload);
    }
    resetForm();
    await loadItems();
    message.value = successMessage;
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

function scopeLabel(scope: PlatformPromotionTag['scope']) {
  return scopeOptions.find((item) => item.value === scope)?.label ?? scope;
}

async function remove(item: PlatformPromotionTag) {
  if (deletingId.value) return;
  if (item.reserved) {
    window.alert('这是系统保留运营标签，不能删除。');
    return;
  }
  const hasReferences = item.merchantReferenceCount > 0;
  if (hasReferences) {
    const impactConfirmed = window.confirm(
      `该标签当前被 ${item.merchantReferenceCount} 个商家使用。删除后，这些商家将同步移除此标签，是否确认删除？`,
    );
    if (!impactConfirmed) return;
    if (!window.confirm(`请再次确认永久删除“${item.nameZh}”。此操作不可恢复。`)) return;
  } else if (!window.confirm('确认删除该标签吗？')) {
    return;
  }
  try {
    deletingId.value = item.id;
    const result = await deletePlatformPromotionTag(item.id, hasReferences);
    if (editingId.value === item.id) resetForm();
    await loadItems();
    message.value = result.affectedMerchantCount > 0
      ? `标签已删除，并从 ${result.affectedMerchantCount} 个商家移除`
      : '标签已删除';
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    deletingId.value = '';
  }
}
</script>

<template>
  <PageHeader title="标签字典管理" description="三类标签均可显示在商家详情；平台运营标签同时承担首页与推荐逻辑。" />
  <p v-if="message" :class="['message', { 'is-success': messageIsSuccess }]" role="status" aria-live="polite">{{ message }}</p>

  <form ref="tagForm" class="card form-grid" @submit.prevent="submit">
    <h2 class="span-2">{{ editingId ? '编辑标签' : '新增标签' }}</h2>
    <label>编码<input v-model="form.code" required maxlength="64" placeholder="HOT_FOOD" :disabled="Boolean(editingId)" />
      <small v-if="editingId">编码用于稳定关联，创建后不能修改。</small>
    </label>
    <label>中文名<input ref="nameZhInput" v-model="form.nameZh" required maxlength="80" /></label>
    <label>越南语名<input v-model="form.nameVi" maxlength="80" /></label>
    <label>英文名<input v-model="form.nameEn" maxlength="80" /></label>
    <label class="span-2">图标 URL<input v-model="form.iconUrl" maxlength="500" :disabled="Boolean(editingItem?.reserved)" /></label>
    <label>图标文本<input v-model="form.iconText" maxlength="16" placeholder="🔥" :disabled="Boolean(editingItem?.reserved)" /></label>
    <label>颜色<input v-model="form.color" maxlength="32" placeholder="#16a34a" :disabled="Boolean(editingItem?.reserved)" /></label>
    <label class="span-2">描述<input v-model="form.description" maxlength="255" :disabled="Boolean(editingItem?.reserved)" /></label>
    <label>用途
      <select v-model="form.scope" :disabled="scopeLocked">
        <option v-for="option in scopeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <small v-if="scopeLocked">用途在创建后不能修改。</small>
      <small v-else>平台运营标签承担首页与推荐逻辑；菜系、场景标签用于详情展示。</small>
    </label>
    <label>排序<input v-model.number="form.sortOrder" type="number" min="0" :disabled="Boolean(editingItem?.reserved)" /></label>
    <label class="check"><input v-model="form.enabled" type="checkbox" :disabled="Boolean(editingItem?.reserved)" />启用
      <small v-if="editingItem?.reserved">系统保留运营标签必须保持启用。</small>
    </label>
    <div class="form-actions span-2">
      <button class="secondary" type="button" :disabled="saving" @click="resetForm">清空</button>
      <button type="submit" :disabled="saving">{{ saving ? '保存中...' : (editingId ? '保存' : '新增') }}</button>
    </div>
  </form>

  <section class="card">
    <div class="platform-table-header">
      <h2>标签列表</h2>
      <button class="secondary" :disabled="loading" @click="loadItems">刷新</button>
    </div>
    <div v-for="group in tagGroups" :key="group.value" class="tag-group">
      <div class="tag-group-heading">
        <h3>{{ group.label }}</h3>
        <span>{{ group.items.length }} 个</span>
      </div>
      <p v-if="group.items.length === 0" class="empty-state">暂无{{ group.label }}标签</p>
      <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>编码</th>
            <th>名称</th>
            <th>用途</th>
            <th>展示</th>
            <th>排序</th>
            <th>状态</th>
            <th>商家引用</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in group.items" :key="item.id" :class="{ 'is-editing': editingId === item.id }">
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
              {{ item.merchantReferenceCount }}
              <small v-if="item.reserved" class="reserved-badge">系统保留</small>
            </td>
            <td>
              <button class="small secondary" @click="edit(item)">{{ editingId === item.id ? '正在编辑' : '编辑' }}</button>
              <button class="small danger" :disabled="item.reserved || Boolean(deletingId)" @click="remove(item)">
                {{ item.reserved ? '不可删除' : (deletingId === item.id ? '删除中...' : '删除') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.message.is-success {
  color: #166534;
}

.form-grid label small {
  display: block;
  color: #64748b;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.45;
}

.tag-group + .tag-group {
  margin-top: 28px;
}

.tag-group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 0 10px;
  color: #475569;
}

.tag-group-heading h3 {
  margin: 0;
  color: #1e293b;
  font-size: 16px;
}

.tag-group-heading span,
.reserved-badge {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.reserved-badge {
  display: block;
  margin-top: 4px;
  color: #166534;
}

.empty-state {
  margin: 0;
  padding: 18px;
  border-radius: 10px;
  background: #f8fafc;
  color: #64748b;
  text-align: center;
}

tr.is-editing td {
  background: #f0f9f2;
}

@media (max-width: 760px) {
  input,
  select,
  button {
    min-height: 44px;
  }

  th:last-child,
  td:last-child {
    position: sticky;
    right: 0;
    background: #fff;
    box-shadow: -8px 0 12px rgb(15 23 42 / 6%);
  }

  tr.is-editing td:last-child {
    background: #f0f9f2;
  }
}
</style>
