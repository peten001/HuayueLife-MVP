<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createTable,
  disableTable,
  downloadTableQr,
  getTables,
  rotateTableQr,
  updateTable,
} from '@/api/merchant';
import type { DiningTable } from '@/types/api';

const rows = ref<DiningTable[]>([]);
const form = reactive({ id: '', tableNo: '', tableName: '' });
const message = ref('');

async function load() {
  rows.value = await getTables();
}

function edit(row: DiningTable) {
  Object.assign(form, row);
}

function reset() {
  Object.assign(form, { id: '', tableNo: '', tableName: '' });
}

async function save() {
  try {
    const payload = { tableNo: form.tableNo, tableName: form.tableName || undefined };
    if (form.id) await updateTable(form.id, payload);
    else await createTable(payload);
    reset();
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function rotate(row: DiningTable) {
  if (!confirm(`换新 ${row.tableNo} 的二维码？旧二维码将立即失效。`)) return;
  await rotateTableQr(row.id);
  await load();
}

async function disable(row: DiningTable) {
  if (!confirm(`停用桌台 ${row.tableNo}？`)) return;
  await disableTable(row.id);
  await load();
}

onMounted(() => load().catch((error) => (message.value = errorMessage(error))));
</script>

<template>
  <PageHeader title="桌台管理" description="二维码使用随机令牌，换码后旧码立即失效" />
  <form class="card inline-form" @submit.prevent="save">
    <input v-model="form.tableNo" placeholder="桌号，如 A01" required />
    <input v-model="form.tableName" placeholder="显示名称，如一楼 A01" />
    <button>{{ form.id ? '保存修改' : '新增桌台' }}</button>
    <button v-if="form.id" type="button" class="secondary" @click="reset">取消</button>
  </form>
  <p class="message">{{ message }}</p>
  <div class="card table-wrap">
    <table>
      <thead><tr><th>桌号</th><th>名称</th><th>二维码版本</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.tableNo }}</td>
          <td>{{ row.tableName || '-' }}</td>
          <td>v{{ row.qrVersion }}</td>
          <td><span :class="['badge', row.status === 'ACTIVE' ? 'success' : 'muted']">{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</span></td>
          <td class="actions">
            <button class="small secondary" @click="edit(row)">编辑</button>
            <button class="small" @click="downloadTableQr(row)">下载二维码</button>
            <button class="small warning" @click="rotate(row)">换码</button>
            <button v-if="row.status === 'ACTIVE'" class="small danger" @click="disable(row)">停用</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
