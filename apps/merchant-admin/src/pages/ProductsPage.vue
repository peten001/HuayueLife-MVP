<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n, type TranslationKey } from '@/i18n';
import {
  createProduct,
  disableProduct,
  getCategories,
  getProducts,
  uploadProductImage,
  updateProduct,
  updateProductStatus,
} from '@/api/merchant';
import type { Category, Product, ProductStatus } from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

const rows = ref<Product[]>([]);
const { locale, t } = useI18n();
const categories = ref<Category[]>([]);
const message = ref('');
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
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

const imagePreviewUrl = computed(() =>
  form.imageUrl ? resolveMediaUrl(form.imageUrl) : '',
);

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

function openImagePicker() {
  fileInput.value?.click();
}

async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  message.value = '';
  try {
    const result = await uploadProductImage(file);
    form.imageUrl = result.url;
    message.value = t('imageUploaded');
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

function clearImage() {
  form.imageUrl = '';
  if (fileInput.value) {
    fileInput.value.value = '';
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
    <div class="span-2 image-section">
      <div class="image-header">
        <span>{{ t('imageUrl') }}</span>
        <div class="image-actions">
          <button type="button" class="small secondary" :disabled="uploading" @click="openImagePicker">
            {{ form.imageUrl ? t('replaceImage') : t('uploadImage') }}
          </button>
          <button type="button" class="small" :disabled="uploading || !form.imageUrl" @click="clearImage">
            {{ t('clearImage') }}
          </button>
        </div>
      </div>
      <input
        ref="fileInput"
        class="hidden-file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        @change="onImageSelected"
      />
      <div class="image-preview">
        <img v-if="imagePreviewUrl" :src="imagePreviewUrl" :alt="t('imagePreview')" />
        <div v-else class="empty-preview">{{ t('imagePreview') }}</div>
      </div>
      <small class="hint">{{ uploading ? t('uploadingImage') : t('imageUrl') }}</small>
    </div>
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

.image-section {
  display: grid;
  gap: 12px;
}

.image-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.image-actions {
  display: flex;
  gap: 8px;
}

.hidden-file {
  display: none;
}

.image-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  overflow: hidden;
  border: 1px dashed #d8cbc3;
  border-radius: 14px;
  background: #faf7f4;
}

.image-preview img {
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: cover;
}

.empty-preview {
  color: #a29387;
  font-size: 14px;
}

.hint {
  color: #8b7f76;
  font-size: 12px;
}
</style>
