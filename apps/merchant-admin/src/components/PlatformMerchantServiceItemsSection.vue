<script setup lang="ts">
import { ref, watch } from 'vue';
import { errorMessage } from '@/api/http';
import { uploadPlatformMerchantImage } from '@/api/platform';
import { listServiceItems, saveServiceItem, deleteServiceItem, type ServiceItem } from '@/api/explore';
import { resolveMediaUrl } from '@/utils/media';

const props = defineProps<{ merchantId: string; businessTypeCode?: string }>();
const items = ref<ServiceItem[]>([]);
const draft = ref<ServiceItem | null>(null);
const busy = ref(false);
function cloneContent<T>(item: T): T { return JSON.parse(JSON.stringify(item)) as T; }
const loading = ref(false);
const message = ref('');
const failedImages = ref<Set<string>>(new Set());
const sectionTitle = () => props.businessTypeCode === 'HOTEL' ? '房型展示' : props.businessTypeCode === 'KTV' ? '包厢展示' : ['CONVENIENCE_MARKET', 'FLOWER_GIFT', 'FRUIT_FRESH'].includes(props.businessTypeCode ?? '') ? '商品展示' : '服务项目';
async function load() {
  loading.value = true;
  const merchantId = props.merchantId;
  try { const result = await listServiceItems(merchantId); if (merchantId !== props.merchantId) return false; items.value = result.items; return true; }
  catch (error) { if (merchantId === props.merchantId) message.value = errorMessage(error); return false; }
  finally { if (merchantId === props.merchantId) loading.value = false; }
}
function add() { draft.value = { nameZh: '', nameVi: '', nameEn: '', descriptionZh: '', descriptionVi: '', descriptionEn: '', imageUrl: '', durationMinutes: null, priceMode: 'INQUIRY', amountVnd: null, unit: '', sortOrder: items.value.length * 10, isVisible: true }; }
async function save() {
  if (!draft.value || busy.value) return;
  busy.value = true; message.value = '';
  try {
    const data = { ...draft.value, durationMinutes: draft.value.durationMinutes || null, amountVnd: draft.value.priceMode === 'INQUIRY' ? null : draft.value.amountVnd };
    const saved = await saveServiceItem(props.merchantId, data);
    if (!await load()) { message.value = `已保存，但列表回读失败：${message.value}`; return; }
    const reread = items.value.find(item => item.id === saved.id);
    if (!reread) { message.value = '已保存，但回读未找到该项目，请刷新确认。'; return; }
    draft.value = cloneContent(reread); message.value = '已保存并回读验证';
  } catch (error) { message.value = errorMessage(error); }
  finally { busy.value = false; }
}
async function remove(item: ServiceItem) {
  if (!item.id || !window.confirm(`删除“${item.nameZh}”？仅移除本商家展示内容，其他图片引用会保留。`)) return;
  busy.value = true;
  try { await deleteServiceItem(props.merchantId, item.id); if (!await load()) { message.value = `已删除，但列表回读失败：${message.value}`; return; } if (draft.value?.id === item.id) draft.value = null; message.value = '已删除'; }
  catch (error) { message.value = errorMessage(error); }
  finally { busy.value = false; }
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file || !draft.value) return;
  busy.value = true;
  try { const result = await uploadPlatformMerchantImage(file); draft.value.imageUrl = result.imageUrl; }
  catch (error) { message.value = errorMessage(error); }
  finally { input.value = ''; busy.value = false; }
}
watch(() => props.merchantId, () => { items.value = []; draft.value = null; message.value = ''; void load(); }, { immediate: true });
</script>

<template>
  <section class="service-editor">
    <div class="section-header"><div><h3>{{ sectionTitle() }}</h3><p>用于前台展示与电话咨询，价格未知时保留询价。</p></div><button :disabled="busy" @click="add">新增项目</button></div>
    <p v-if="message" class="service-message" role="status">{{ message }}</p>
    <p v-if="loading">加载中…</p>
    <p v-else-if="!items.length">暂无展示内容，前台会隐藏此区块。</p>
    <div v-for="item in items" :key="item.id" class="service-row">
      <img v-if="item.imageUrl && !failedImages.has(item.imageUrl)" :src="resolveMediaUrl(item.imageUrl)" alt="" @error="failedImages.add(item.imageUrl!)" />
      <div><strong>{{ item.nameZh }}</strong><small>{{ item.durationMinutes ? `${item.durationMinutes} 分钟 · ` : '' }}{{ item.priceMode === 'INQUIRY' ? '询价' : `${item.amountVnd} ₫${item.priceMode === 'FROM' ? ' 起' : ''}` }} · {{ item.isVisible ? '显示' : '隐藏' }} · 排序 {{ item.sortOrder }}</small></div>
      <button :disabled="busy" @click="draft = cloneContent(item)">编辑</button><button :disabled="busy" @click="remove(item)">删除</button>
    </div>
    <form v-if="draft" class="service-form" @submit.prevent="save">
      <label>项目中文名称<input v-model="draft.nameZh" maxlength="120" required /></label>
      <label>越文名称<input v-model="draft.nameVi" maxlength="120" /></label>
      <label>英文名称<input v-model="draft.nameEn" maxlength="120" /></label>
      <label>中文规格/说明<textarea v-model="draft.descriptionZh" maxlength="500" /></label>
      <label>越文规格/说明<textarea v-model="draft.descriptionVi" maxlength="500" /></label>
      <label>英文规格/说明<textarea v-model="draft.descriptionEn" maxlength="500" /></label>
      <label>时长（选填，分钟）<input v-model.number="draft.durationMinutes" type="number" min="1" max="1440" /></label>
      <label>价格方式<select v-model="draft.priceMode" @change="draft.priceMode === 'INQUIRY' && (draft.amountVnd = null)"><option value="INQUIRY">询价</option><option value="FIXED">固定价</option><option value="FROM">起价</option></select></label>
      <label v-if="draft.priceMode !== 'INQUIRY'">金额（VND）<input v-model="draft.amountVnd" inputmode="numeric" pattern="[0-9]{1,12}" required /></label>
      <label>单位（选填）<input v-model="draft.unit" maxlength="32" placeholder="如：间/晚" /></label>
      <label>排序<input v-model.number="draft.sortOrder" type="number" min="0" max="9999" required /></label>
      <label>图片<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="upload" /></label>
      <div v-if="draft.imageUrl" class="service-image-preview"><img :src="resolveMediaUrl(draft.imageUrl)" alt="项目图片预览" /><button type="button" @click="draft.imageUrl = null">移除图片</button></div>
      <label class="check"><input v-model="draft.isVisible" type="checkbox" />前台显示</label>
      <div class="form-actions"><button type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存项目' }}</button><button type="button" :disabled="busy" @click="draft = null">关闭编辑</button></div>
    </form>
  </section>
</template>

<style scoped>
.section-header,.service-row,.form-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.section-header{justify-content:space-between}.section-header p,.service-row small{color:#727a76;font-size:13px;line-height:1.6}.service-row{padding:14px 0;border-bottom:1px solid #edf1ee}.service-row>img{width:84px;height:64px;object-fit:cover;border-radius:8px}.service-row>div{flex:1;min-width:140px;overflow-wrap:anywhere}.service-row small{display:block;margin-top:5px}.service-form{margin-top:22px;padding:18px;background:#f5f9f6;border-radius:12px;display:grid;grid-template-columns:1fr 1fr;gap:14px}.service-form label:not(.check){display:grid;gap:6px}.service-form input:not([type=checkbox]),.service-form textarea,.service-form select{width:100%;box-sizing:border-box}.service-form textarea{min-height:76px}.service-image-preview img{width:120px;height:88px;object-fit:cover;border-radius:8px}.service-image-preview{display:flex;align-items:center;gap:12px}.form-actions{grid-column:1/-1}.service-message{padding:12px;background:#eaf7ee;border-radius:8px}@media(max-width:700px){.service-form{grid-template-columns:1fr}}
</style>
