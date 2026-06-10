<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createProduct,
  disableProduct,
  getCategories,
  getProducts,
  updateProduct,
  updateProductStatus,
} from '@/api/merchant';
import type { Category, Product, ProductStatus } from '@/types/api';

const rows = ref<Product[]>([]);
const categories = ref<Category[]>([]);
const message = ref('');
const form = reactive({
  id: '',
  categoryId: '',
  nameZh: '',
  nameVi: '',
  description: '',
  imageUrl: '',
  priceVnd: 0,
  sortOrder: 0,
});

async function load() {
  [rows.value, categories.value] = await Promise.all([
    getProducts(),
    getCategories(),
  ]);
}

function edit(row: Product) {
  Object.assign(form, {
    ...row,
    priceVnd: Number(row.priceVnd),
  });
}

function reset() {
  Object.assign(form, {
    id: '',
    categoryId: categories.value.find((item) => item.isActive)?.id ?? '',
    nameZh: '',
    nameVi: '',
    description: '',
    imageUrl: '',
    priceVnd: 0,
    sortOrder: 0,
  });
}

async function save() {
  try {
    const payload = {
      categoryId: form.categoryId,
      nameZh: form.nameZh,
      nameVi: form.nameVi || undefined,
      description: form.description || undefined,
      imageUrl: form.imageUrl || undefined,
      priceVnd: form.priceVnd,
      sortOrder: form.sortOrder,
    };
    if (form.id) await updateProduct(form.id, payload);
    else await createProduct(payload);
    await load();
    reset();
    message.value = '菜品已保存';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function setStatus(row: Product, status: ProductStatus) {
  await updateProductStatus(row.id, status);
  await load();
}

async function disable(row: Product) {
  if (!confirm(`下架菜品“${row.nameZh}”？`)) return;
  await disableProduct(row.id);
  await load();
}

onMounted(async () => {
  try {
    await load();
    reset();
  } catch (error) {
    message.value = errorMessage(error);
  }
});
</script>

<template>
  <PageHeader title="菜品管理" description="V1 仅支持 FOOD，不提供规格、加料和库存" />
  <form class="card form-grid" @submit.prevent="save">
    <label>分类<select v-model="form.categoryId" required><option v-for="item in categories.filter((c) => c.isActive)" :key="item.id" :value="item.id">{{ item.nameZh }}</option></select></label>
    <label>中文菜名<input v-model="form.nameZh" required /></label>
    <label>越南语菜名<input v-model="form.nameVi" /></label>
    <label>价格（VND）<input v-model.number="form.priceVnd" type="number" min="0" required /></label>
    <label>排序<input v-model.number="form.sortOrder" type="number" min="0" /></label>
    <label>图片 URL<input v-model="form.imageUrl" type="url" /></label>
    <label class="span-2">描述<textarea v-model="form.description" rows="3" /></label>
    <div class="form-actions span-2">
      <button>{{ form.id ? '保存修改' : '新增菜品' }}</button>
      <button v-if="form.id" type="button" class="secondary" @click="reset">取消</button>
    </div>
  </form>
  <p class="message">{{ message }}</p>
  <div class="card table-wrap">
    <table>
      <thead><tr><th>菜品</th><th>分类</th><th>价格</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.nameZh }}<small>{{ row.nameVi }}</small></td>
          <td>{{ row.category.nameZh }}</td>
          <td>{{ Number(row.priceVnd).toLocaleString() }} ₫</td>
          <td><span class="badge">{{ row.status }}</span></td>
          <td class="actions">
            <button class="small secondary" @click="edit(row)">编辑</button>
            <button class="small" @click="setStatus(row, 'ON_SALE')">上架</button>
            <button class="small warning" @click="setStatus(row, 'SOLD_OUT')">售罄</button>
            <button class="small danger" @click="disable(row)">下架</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
