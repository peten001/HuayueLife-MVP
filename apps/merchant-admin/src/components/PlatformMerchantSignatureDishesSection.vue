<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  createPlatformMerchantSignatureDish,
  deletePlatformMerchantSignatureDish,
  getPlatformMerchantSignatureDishes,
  movePlatformMerchantSignatureDish,
  updatePlatformMerchantSignatureDish,
  uploadPlatformMerchantImage,
} from '@/api/platform';
import type { PlatformMerchantSignatureDish } from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

const props = defineProps<{
  merchantId: string;
  usesMenuSignatureCategory?: boolean;
}>();
const dishes = ref<PlatformMerchantSignatureDish[]>([]);
const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);
const message = ref('');
const editingId = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const form = reactive({ nameZh: '', nameVi: '', nameEn: '', imageUrl: '', isVisible: true });
const atLimit = computed(() => dishes.value.length >= 15);

function reset() {
  editingId.value = '';
  Object.assign(form, { nameZh: '', nameVi: '', nameEn: '', imageUrl: '', isVisible: true });
  if (fileInput.value) fileInput.value.value = '';
}

async function load() {
  loading.value = true;
  try { dishes.value = await getPlatformMerchantSignatureDishes(props.merchantId); }
  catch (error) { message.value = errorMessage(error); }
  finally { loading.value = false; }
}

function edit(item: PlatformMerchantSignatureDish) {
  editingId.value = item.id;
  Object.assign(form, { nameZh: item.nameZh, nameVi: item.nameVi ?? '', nameEn: item.nameEn ?? '', imageUrl: item.imageUrl, isVisible: item.isVisible });
}

async function save() {
  message.value = '';
  if (!form.nameZh.trim() || !form.imageUrl.trim()) { message.value = '请填写中文名称并上传图片。'; return; }
  saving.value = true;
  try {
    const contentPayload = {
      nameZh: form.nameZh.trim(),
      nameVi: form.nameVi.trim() || null,
      nameEn: form.nameEn.trim() || null,
      imageUrl: form.imageUrl.trim(),
    };
    if (editingId.value) {
      await updatePlatformMerchantSignatureDish(props.merchantId, editingId.value, {
        ...contentPayload,
        isVisible: form.isVisible,
      });
    } else {
      await createPlatformMerchantSignatureDish(props.merchantId, contentPayload);
    }
    await load(); reset();
  } catch (error) { message.value = errorMessage(error); }
  finally { saving.value = false; }
}

async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  uploading.value = true; message.value = '';
  try { form.imageUrl = (await uploadPlatformMerchantImage(file)).imageUrl; }
  catch (error) { message.value = errorMessage(error); }
  finally { uploading.value = false; }
}

async function move(item: PlatformMerchantSignatureDish, direction: 'UP' | 'DOWN') {
  try { await movePlatformMerchantSignatureDish(props.merchantId, item.id, direction); await load(); }
  catch (error) { message.value = errorMessage(error); }
}

async function toggle(item: PlatformMerchantSignatureDish) {
  try { await updatePlatformMerchantSignatureDish(props.merchantId, item.id, { isVisible: !item.isVisible }); await load(); }
  catch (error) { message.value = errorMessage(error); }
}

async function remove(item: PlatformMerchantSignatureDish) {
  if (!confirm(`确认永久删除“${item.nameZh}”吗？删除后无法恢复，并会释放一个招牌菜名额。`)) return;
  try { await deletePlatformMerchantSignatureDish(props.merchantId, item.id); if (editingId.value === item.id) reset(); await load(); }
  catch (error) { message.value = errorMessage(error); }
}

onMounted(() => {
  if (!props.usesMenuSignatureCategory) void load();
});
</script>

<template>
  <section class="editor-section-card">
    <div v-if="usesMenuSignatureCategory" class="signature-category-notice">
      <strong>招牌菜由商家菜单维护</strong>
      <p>该商家的招牌菜由商家后台菜单中的招牌菜分类维护。</p>
    </div>
    <template v-else>
      <div class="editor-section-head"><div><h2>招牌菜</h2><p>独立商家内容，不关联菜单商品或销量；隐藏项目仍计入额度。</p></div><strong>{{ dishes.length }} / 15</strong></div>
      <form class="editor-form-grid" @submit.prevent="save">
      <label><span>中文名称 <b>*</b></span><input v-model="form.nameZh" maxlength="120" required /></label>
      <label><span>越南文名称</span><input v-model="form.nameVi" maxlength="120" /></label>
      <label><span>英文名称</span><input v-model="form.nameEn" maxlength="120" /></label>
      <label class="span-3"><span>招牌菜图片 <b>*</b></span><input ref="fileInput" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" :disabled="uploading" @change="upload" /><small>{{ uploading ? '上传中...' : 'JPEG / PNG / WebP，最大 5MB' }}</small></label>
      <div v-if="form.imageUrl" class="signature-preview span-3"><img :src="resolveMediaUrl(form.imageUrl)" alt="招牌菜图片预览" /></div>
      <label v-if="editingId" class="switch-row"><input v-model="form.isVisible" type="checkbox" />前台展示</label>
      <div class="section-actions span-3"><button class="editor-button is-primary" :disabled="saving || (!editingId && atLimit)">{{ saving ? '保存中...' : editingId ? '保存招牌菜' : atLimit ? '已达 15 道上限' : '新增招牌菜' }}</button><button v-if="editingId" type="button" class="editor-button" @click="reset">取消编辑</button></div>
      </form>
      <p v-if="message" class="editor-warning">{{ message }}</p>
      <div v-if="loading" class="empty">招牌菜加载中...</div>
      <div v-else-if="dishes.length" class="signature-list">
      <article v-for="(item, index) in dishes" :key="item.id" :class="['signature-card', { hidden: !item.isVisible }]">
        <img :src="resolveMediaUrl(item.imageUrl)" :alt="item.nameZh" />
        <div><strong>{{ item.nameZh }}</strong><small>{{ item.nameVi || '—' }} · {{ item.nameEn || '—' }}</small><em>{{ item.isVisible ? '展示中' : '已隐藏' }}</em></div>
        <div class="section-actions"><button class="small secondary" :disabled="index === 0" @click="move(item, 'UP')">上移</button><button class="small secondary" :disabled="index === dishes.length - 1" @click="move(item, 'DOWN')">下移</button><button class="small secondary" @click="edit(item)">编辑</button><button class="small secondary" @click="toggle(item)">{{ item.isVisible ? '隐藏' : '恢复' }}</button><button class="small danger" @click="remove(item)">永久删除</button></div>
      </article>
      </div>
      <p v-else class="empty">暂无招牌菜，可为展示型商家独立维护。</p>
    </template>
  </section>
</template>

<style scoped>
.editor-section-card {
  padding: 20px 22px;
  border: 1px solid #dce8df;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 2px 10px rgb(15 83 48 / 4%);
}

.editor-section-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding-bottom: 14px;
  border-bottom: 1px solid #e7eee9;
}

.editor-section-head h2 {
  margin: 0;
  color: #173622;
  font-size: 18px;
}

.editor-section-head p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.editor-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  margin-top: 18px;
}

.editor-form-grid label {
  display: grid;
  gap: 6px;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.editor-form-grid input {
  min-width: 0;
  min-height: 40px;
  padding: 0 11px;
  border: 1px solid #d4e2d8;
  border-radius: 10px;
  background: #ffffff;
}

.span-3 {
  grid-column: 1 / -1;
}

.section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.editor-button,
.small {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid #cfe8d6;
  border-radius: 9px;
  background: #f3fbf5;
  color: #147a35;
  font-weight: 700;
  cursor: pointer;
}

.editor-button.is-primary {
  border-color: #9bcfa8;
  background: #edf8f0;
  color: #246b32;
}

.editor-button:focus-visible,
.small:focus-visible,
.editor-form-grid input:focus-visible {
  outline: 3px solid rgb(67 160 71 / 24%);
  outline-offset: 2px;
}

.editor-warning {
  color: #b91c1c;
}

.empty {
  padding: 18px 0;
  color: #64748b;
}

.signature-list {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.signature-card {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 11px;
  border: 1px solid #dfe9e2;
  border-radius: 12px;
  background: #fbfdfb;
}

.signature-card.hidden {
  opacity: 0.62;
  background: #f8fafc;
}

.signature-card img,
.signature-preview img {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 10px;
}

.signature-card small,
.signature-card em {
  display: block;
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
}

.signature-card em {
  color: #b45309;
  font-style: normal;
}

.signature-preview {
  margin-top: 6px;
}

.danger {
  border-color: #fecaca;
  background: #fff5f5;
  color: #b91c1c;
}

.signature-category-notice {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid #cfe8d6;
  border-radius: 12px;
  background: #f3fbf5;
  color: #166534;
}

.signature-category-notice strong {
  font-size: 16px;
}

.signature-category-notice p {
  margin: 0;
  line-height: 1.6;
}

@media (max-width: 760px) {
  .editor-section-card {
    padding: 18px 16px;
  }

  .editor-section-head {
    align-items: stretch;
    flex-direction: column;
  }

  .editor-form-grid {
    grid-template-columns: 1fr;
  }

  .editor-form-grid input,
  .editor-button,
  .small {
    min-height: 44px;
  }

  .signature-card {
    grid-template-columns: 64px 1fr;
  }

  .signature-card img {
    width: 64px;
    height: 64px;
  }

  .signature-card .section-actions {
    grid-column: 1 / -1;
  }
}
</style>
