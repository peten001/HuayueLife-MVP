<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n } from '@/i18n';
import {
  createCategory,
  disableCategory,
  getCategories,
  updateCategory,
} from '@/api/merchant';
import type { Category } from '@/types/api';

const rows = ref<Category[]>([]);
const { t } = useI18n();
const form = reactive({ id: '', nameZh: '', nameVi: '', sortOrder: 0 });
const message = ref('');

async function load() {
  rows.value = await getCategories();
}

function edit(row: Category) {
  Object.assign(form, row);
}

function reset() {
  Object.assign(form, { id: '', nameZh: '', nameVi: '', sortOrder: 0 });
}

async function save() {
  try {
    const payload = {
      nameZh: form.nameZh,
      nameVi: form.nameVi || undefined,
      sortOrder: form.sortOrder,
    };
    if (form.id) await updateCategory(form.id, payload);
    else await createCategory(payload);
    reset();
    await load();
    message.value = t('categorySaved');
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function disable(row: Category) {
  if (!confirm(t('disableCategoryConfirm', { name: row.nameZh }))) return;
  await disableCategory(row.id);
  await load();
}

onMounted(() => load().catch((error) => (message.value = errorMessage(error))));
</script>

<template>
  <PageHeader :title="t('categories')" :description="t('categoriesDescription')" />
  <form class="card inline-form" @submit.prevent="save">
    <input v-model="form.nameZh" :placeholder="t('chineseCategoryName')" required />
    <input v-model="form.nameVi" :placeholder="t('vietnameseCategoryName')" />
    <input v-model.number="form.sortOrder" type="number" min="0" :placeholder="t('sortOrder')" />
    <button>{{ form.id ? t('saveChanges') : t('addCategory') }}</button>
    <button v-if="form.id" type="button" class="secondary" @click="reset">{{ t('cancel') }}</button>
  </form>
  <p class="message">{{ message }}</p>
  <div class="card table-wrap">
    <table>
      <thead><tr><th>{{ t('category') }}</th><th>{{ t('sortOrder') }}</th><th>{{ t('productCount') }}</th><th>{{ t('status') }}</th><th>{{ t('actions') }}</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.nameZh }}<small>{{ row.nameVi }}</small></td>
          <td>{{ row.sortOrder }}</td>
          <td>{{ row._count?.products ?? 0 }}</td>
          <td><span :class="['badge', row.isActive ? 'success' : 'muted']">{{ row.isActive ? t('enabled') : t('disable') }}</span></td>
          <td class="actions">
            <button class="small secondary" @click="edit(row)">{{ t('edit') }}</button>
            <button v-if="row.isActive" class="small danger" @click="disable(row)">{{ t('disable') }}</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
