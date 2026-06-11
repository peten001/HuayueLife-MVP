<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n, type TranslationKey } from '@/i18n';
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
const { locale, t } = useI18n();
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
    nameVi: row.nameVi ?? '',
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
      nameZh: form.nameZh.trim(),
      nameVi: form.nameVi.trim(),
      description: form.description || undefined,
      imageUrl: form.imageUrl || undefined,
      priceVnd: form.priceVnd,
      sortOrder: form.sortOrder,
    };
    if (form.id) await updateProduct(form.id, payload);
    else await createProduct(payload);
    await load();
    reset();
    message.value = t('productSaved');
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function setStatus(row: Product, status: ProductStatus) {
  await updateProductStatus(row.id, status);
  await load();
}

async function disable(row: Product) {
  if (!confirm(t('disableProductConfirm', { name: productName(row) }))) return;
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

function productName(row: Product) {
  return locale.value === 'vi' && row.nameVi ? row.nameVi : row.nameZh;
}

function categoryName(category: Category) {
  return locale.value === 'vi' && category.nameVi
    ? category.nameVi
    : category.nameZh;
}

function productStatusLabel(status: ProductStatus) {
  const labels: Record<ProductStatus, TranslationKey> = {
    DRAFT: 'draft',
    ON_SALE: 'onSale',
    SOLD_OUT: 'soldOut',
    OFF_SALE: 'offSale',
  };
  return t(labels[status]);
}
</script>

<template>
  <PageHeader :title="t('products')" :description="t('productsDescription')" />
  <form class="card form-grid" @submit.prevent="save">
    <label>{{ t('category') }}<select v-model="form.categoryId" required><option v-for="item in categories.filter((c) => c.isActive)" :key="item.id" :value="item.id">{{ categoryName(item) }}</option></select></label>
    <label>
      {{ t('chineseProductName') }} <span class="required">{{ t('required') }}</span>
      <input v-model="form.nameZh" required />
    </label>
    <label>
      {{ t('vietnameseProductName') }} <span class="required">{{ t('required') }}</span>
      <input v-model="form.nameVi" required />
    </label>
    <label>{{ t('priceVnd') }}<input v-model.number="form.priceVnd" type="number" min="0" required /></label>
    <label>{{ t('sortOrder') }}<input v-model.number="form.sortOrder" type="number" min="0" /></label>
    <label>{{ t('imageUrl') }}<input v-model="form.imageUrl" type="url" /></label>
    <label class="span-2">{{ t('description') }}<textarea v-model="form.description" rows="3" /></label>
    <div class="form-actions span-2">
      <button>{{ form.id ? t('saveChanges') : t('addProduct') }}</button>
      <button v-if="form.id" type="button" class="secondary" @click="reset">{{ t('cancel') }}</button>
    </div>
  </form>
  <p class="message">{{ message }}</p>
  <div class="card table-wrap">
    <table>
      <thead><tr><th>{{ t('product') }}</th><th>{{ t('category') }}</th><th>{{ t('price') }}</th><th>{{ t('status') }}</th><th>{{ t('actions') }}</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ productName(row) }}<small>{{ locale === 'vi' ? row.nameZh : row.nameVi }}</small></td>
          <td>{{ categoryName(row.category) }}</td>
          <td>{{ Number(row.priceVnd).toLocaleString() }} ₫</td>
          <td><span class="badge">{{ productStatusLabel(row.status) }}</span></td>
          <td class="actions">
            <button class="small secondary" @click="edit(row)">{{ t('edit') }}</button>
            <button class="small" @click="setStatus(row, 'ON_SALE')">{{ t('onSale') }}</button>
            <button class="small warning" @click="setStatus(row, 'SOLD_OUT')">{{ t('soldOut') }}</button>
            <button class="small danger" @click="disable(row)">{{ t('offSale') }}</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.required {
  color: #b83228;
  font-size: 12px;
}
</style>
