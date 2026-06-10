<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createCategory,
  disableCategory,
  getCategories,
  updateCategory,
} from '@/api/merchant';
import type { Category } from '@/types/api';

const rows = ref<Category[]>([]);
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
    message.value = '分类已保存';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function disable(row: Category) {
  if (!confirm(`停用分类“${row.nameZh}”？分类下菜品也会下架。`)) return;
  await disableCategory(row.id);
  await load();
}

onMounted(() => load().catch((error) => (message.value = errorMessage(error))));
</script>

<template>
  <PageHeader title="分类管理" description="删除操作只停用分类，不删除历史数据" />
  <form class="card inline-form" @submit.prevent="save">
    <input v-model="form.nameZh" placeholder="中文分类名" required />
    <input v-model="form.nameVi" placeholder="越南语分类名" />
    <input v-model.number="form.sortOrder" type="number" min="0" placeholder="排序" />
    <button>{{ form.id ? '保存修改' : '新增分类' }}</button>
    <button v-if="form.id" type="button" class="secondary" @click="reset">取消</button>
  </form>
  <p class="message">{{ message }}</p>
  <div class="card table-wrap">
    <table>
      <thead><tr><th>分类</th><th>排序</th><th>菜品数</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.nameZh }}<small>{{ row.nameVi }}</small></td>
          <td>{{ row.sortOrder }}</td>
          <td>{{ row._count?.products ?? 0 }}</td>
          <td><span :class="['badge', row.isActive ? 'success' : 'muted']">{{ row.isActive ? '启用' : '停用' }}</span></td>
          <td class="actions">
            <button class="small secondary" @click="edit(row)">编辑</button>
            <button v-if="row.isActive" class="small danger" @click="disable(row)">停用</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
