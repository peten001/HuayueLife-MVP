<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getPlatformBusinessTypes, getPlatformPromotionTags, uploadPlatformMerchantImage } from '@/api/platform';
import { listExploreCategories, listExploreTopics, saveExploreCategory, saveExploreTopic, deleteExploreTopic, initializeExplore, type ExploreCategory, type ExploreTopic } from '@/api/explore';
import type { PlatformBusinessType, PlatformPromotionTag } from '@/types/api';
import { merchantCategoryOptions } from '@/utils/merchant-categories';
import { resolveMediaUrl } from '@/utils/media';

const categories = ref<ExploreCategory[]>([]);
const topics = ref<ExploreTopic[]>([]);
const types = ref<PlatformBusinessType[]>([]);
const tags = ref<PlatformPromotionTag[]>([]);
const loading = ref(false);
const busy = ref(false);
function cloneContent<T>(item: T): T { return JSON.parse(JSON.stringify(item)) as T; }
const message = ref('');
const categoryDraft = ref<ExploreCategory | null>(null);
const topicDraft = ref<ExploreTopic | null>(null);
const icons = ['food', 'coffee', 'massage', 'hotel', 'ktv', 'beauty', 'shop', 'fresh', 'sport', 'all', 'chinese', 'noodles', 'vietnamese', 'flowers', 'fruit', 'japanese', 'thai', 'seafood', 'korean', 'western', 'hotpot', 'barbecue', 'buffet', 'bakery', 'fastfood', 'vegetarian'];
const legacyOptions = merchantCategoryOptions().map(item => ({ code: item.value, label: item.label }));
const previewFailed = reactive({ topic: false });
async function load() {
  loading.value = true;
  try { [categories.value, topics.value, types.value, tags.value] = await Promise.all([listExploreCategories(), listExploreTopics(), getPlatformBusinessTypes(), getPlatformPromotionTags()]); return true; }
  catch (error) { message.value = errorMessage(error); return false; }
  finally { loading.value = false; }
}
async function run(action: () => Promise<unknown>) {
  busy.value = true; message.value = '';
  try { await action(); if (!await load()) { message.value = `操作已完成，但回读失败：${message.value}`; return false; } message.value = '已保存并回读验证'; return true; }
  catch (error) { message.value = errorMessage(error); return false; }
  finally { busy.value = false; }
}
async function saveCategoryDraft() {
  if (!categoryDraft.value || busy.value) return;
  const code = categoryDraft.value.code;
  if (await run(() => saveExploreCategory(categoryDraft.value!))) {
    const reread = categories.value.find(item => item.code === code);
    if (reread) categoryDraft.value = cloneContent(reread);
    else message.value = '已保存，但回读未找到该分类，请刷新确认。';
  }
}
async function saveTopicDraft() {
  if (!topicDraft.value || busy.value) return;
  const code = topicDraft.value.code;
  if (await run(() => saveExploreTopic(topicDraft.value!))) {
    const reread = topics.value.find(item => item.code === code);
    if (reread) topicDraft.value = cloneContent(reread);
    else message.value = '已保存，但回读未找到该专题，请刷新确认。';
  }
}
function newCategory() { categoryDraft.value = { code: '', nameZh: '', nameVi: '', nameEn: '', iconKey: 'food', sortOrder: 110, enabled: true, businessTypeCodes: [], legacyKeys: [] }; }
function newTopic() { topicDraft.value = { code: '', nameZh: '', nameVi: '', nameEn: '', subtitleZh: '', subtitleVi: '', subtitleEn: '', regions: [], sortOrder: 20, enabled: false }; previewFailed.topic = false; }
async function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file || !topicDraft.value) return;
  busy.value = true;
  try { const result = await uploadPlatformMerchantImage(file); topicDraft.value.imageUrl = result.imageUrl; previewFailed.topic = false; }
  catch (error) { message.value = errorMessage(error); }
  finally { input.value = ''; busy.value = false; }
}
async function removeTopic(item: ExploreTopic) {
  if (!window.confirm(`删除专题“${item.nameZh}”？该专题配置将移除，商家与图片文件会保留。`)) return;
  await run(() => deleteExploreTopic(item.code)); if (topicDraft.value?.code === item.code) topicDraft.value = null;
}
onMounted(load);
</script>

<template>
  <PageHeader title="生活分类与场景专题" description="维护生活分类。首页生活灵感自动推荐，商家行业与点餐权限分别管理。" />
  <div class="explore-toolbar">
    <router-link to="/platform/merchant-types">商家类型配置</router-link>
    <button :disabled="busy" @click="run(initializeExplore)">补齐分类与未启用专题模板</button>
    <button :disabled="loading || busy" @click="load">刷新</button>
  </div>
  <p v-if="message" class="explore-message" role="status">{{ message }}</p>
  <p v-if="loading">加载中…</p>
  <div class="explore-columns">
    <section class="card">
      <div class="explore-heading"><h2>生活分类</h2><button @click="newCategory">新增分类</button></div>
      <p class="hint">全部分类与常用入口使用同一套图标。行业和商家分类关联采用“或”；菜系入口按商家勾选的分类筛选。</p>
      <div v-for="item in categories" :key="item.code" class="content-row">
        <div><strong>{{ item.nameZh }}</strong><small>{{ item.code }} · 排序 {{ item.sortOrder }} · {{ item.enabled ? '显示' : '隐藏' }}</small></div>
        <button :disabled="busy" @click="categoryDraft = cloneContent(item)">编辑</button>
      </div>
      <form v-if="categoryDraft" class="content-form" @submit.prevent="saveCategoryDraft">
        <h3>分类编辑</h3>
        <label>编码<input v-model="categoryDraft.code" required pattern="[a-z][a-z0-9_-]{0,47}" :readonly="categories.some(c => c.code === categoryDraft?.code)" /></label>
        <label>中文名称<input v-model="categoryDraft.nameZh" required maxlength="80" /></label>
        <label>越文名称<input v-model="categoryDraft.nameVi" maxlength="80" /></label>
        <label>英文名称<input v-model="categoryDraft.nameEn" maxlength="80" /></label>
        <label>图标<select v-model="categoryDraft.iconKey"><option v-for="icon in icons" :key="icon">{{ icon }}</option></select></label>
        <label>排序<input v-model.number="categoryDraft.sortOrder" type="number" min="0" max="9999" required /></label>
        <label class="check"><input v-model="categoryDraft.enabled" type="checkbox" />首页显示</label>
        <template v-if="!categoryDraft.navigationOnly">
          <fieldset><legend>关联行业</legend><label v-for="type in types.filter(t => t.enabled)" :key="type.code" class="check"><input v-model="categoryDraft.businessTypeCodes" type="checkbox" :value="type.code" />{{ type.nameZh }}</label></fieldset>
          <fieldset><legend>商家分类</legend><label v-for="key in legacyOptions" :key="key.code" class="check"><input v-model="categoryDraft.legacyKeys" type="checkbox" :value="key.code" />{{ key.label }}</label></fieldset>
        </template>
        <div class="form-actions"><button type="submit" :disabled="busy">保存分类</button><button type="button" @click="categoryDraft = null">关闭</button></div>
      </form>
    </section>
    <section class="card">
      <div class="explore-heading"><h2>原有场景专题</h2><button @click="newTopic">新增专题</button></div>
      <p class="hint">这里保留原有专题配置。新版首页“生活灵感”按越南时间、定位和营业状态自动推荐商家，无需配置专题。</p>
      <p v-if="!topics.length" class="hint">尚无专题，可新增或初始化未启用模板。</p>
      <div v-for="item in topics" :key="item.code" class="content-row">
        <div><strong>{{ item.nameZh }}</strong><small>{{ item.enabled ? '启用' : '未启用' }} · 排序 {{ item.sortOrder }}</small></div>
        <button :disabled="busy" @click="topicDraft = cloneContent(item); previewFailed.topic = false">编辑</button><button :disabled="busy" @click="removeTopic(item)">删除</button>
      </div>
      <form v-if="topicDraft" class="content-form" @submit.prevent="saveTopicDraft">
        <h3>专题编辑</h3>
        <label>编码<input v-model="topicDraft.code" required pattern="[a-z][a-z0-9_-]{0,47}" :readonly="topics.some(t => t.code === topicDraft?.code)" /></label>
        <label>中文标题<input v-model="topicDraft.nameZh" required maxlength="80" /></label>
        <label>越文标题<input v-model="topicDraft.nameVi" maxlength="80" /></label>
        <label>英文标题<input v-model="topicDraft.nameEn" maxlength="80" /></label>
        <label>中文副标题<input v-model="topicDraft.subtitleZh" maxlength="120" /></label>
        <label>越文副标题<input v-model="topicDraft.subtitleVi" maxlength="120" /></label>
        <label>英文副标题<input v-model="topicDraft.subtitleEn" maxlength="120" /></label>
        <label>封面图片<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="upload" /></label>
        <div v-if="topicDraft.imageUrl && !previewFailed.topic" class="topic-preview"><img :src="resolveMediaUrl(topicDraft.imageUrl)" alt="专题预览" @error="previewFailed.topic = true" /><div><strong>{{ topicDraft.nameZh }}</strong><small>{{ topicDraft.subtitleZh }}</small></div></div>
        <button v-if="topicDraft.imageUrl" type="button" @click="topicDraft.imageUrl = ''">移除图片</button>
        <fieldset><legend>适用城市（不选为全部）</legend><label v-for="region in ['北宁', '北江']" :key="region" class="check"><input v-model="topicDraft.regions" type="checkbox" :value="region" />{{ region }}</label></fieldset>
        <label>目标分类<select v-model="topicDraft.categoryCode"><option value="">不限制</option><option v-for="category in categories.filter(c => c.enabled && !c.navigationOnly)" :key="category.code" :value="category.code">{{ category.nameZh }}</option></select></label>
        <label>目标场景/运营标签<select v-model="topicDraft.promotionTagCode"><option value="">不限制</option><option v-for="tag in tags.filter(t => t.enabled && ['OPERATIONAL', 'SCENE'].includes(t.scope))" :key="tag.code" :value="tag.code">{{ tag.nameZh }}</option></select></label>
        <p class="hint">同时选择分类与标签时，商家须同时满足两项条件。</p>
        <label>排序<input v-model.number="topicDraft.sortOrder" type="number" min="0" max="9999" required /></label>
        <label class="check"><input v-model="topicDraft.enabled" type="checkbox" />启用专题</label>
        <div class="form-actions"><button :disabled="busy" type="submit">保存专题</button><button type="button" @click="topicDraft = null">关闭</button></div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.explore-toolbar,.explore-heading,.content-row,.form-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.explore-toolbar{margin-bottom:18px}.explore-heading{justify-content:space-between}.explore-columns{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}.card{padding:20px;min-width:0}.content-row{padding:14px 0;border-bottom:1px solid #edf1ee}.content-row>div{flex:1;min-width:0}.content-row strong{overflow-wrap:anywhere}.content-row small,.topic-preview small{display:block;margin-top:5px;color:#727a76}.content-form{margin-top:22px;display:grid;gap:12px}.content-form label:not(.check){display:grid;gap:5px}.content-form input:not([type=checkbox]),.content-form select{width:100%;box-sizing:border-box}.content-form fieldset{border:1px solid #e3eae5;border-radius:10px;display:flex;gap:10px;flex-wrap:wrap;padding:12px}.check{display:flex;align-items:center;gap:6px}.topic-preview{position:relative;aspect-ratio:1.8;overflow:hidden;border-radius:12px;background:#f3f8f5}.topic-preview img{width:100%;height:100%;object-fit:cover}.topic-preview>div{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:16px;color:white;background:linear-gradient(transparent 30%,rgba(0,0,0,.65))}.topic-preview small{color:white}.explore-message{padding:12px;border-radius:8px;background:#eaf7ee}.hint{font-size:13px;line-height:1.6}@media(max-width:900px){.explore-columns{grid-template-columns:1fr}}
</style>
