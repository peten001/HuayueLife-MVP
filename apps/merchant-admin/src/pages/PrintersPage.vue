<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createPrinter,
  deletePrinter,
  getPrinters,
  testPrinter,
  updatePrinter,
} from '@/api/printers';
import { useI18n } from '@/i18n';
import type {
  PrintLanguage,
  PrinterEncoding,
  PrinterPayload,
  PrinterSetting,
  PrinterUsageType,
} from '@/types/api';

const { locale, t } = useI18n();
const rows = ref<PrinterSetting[]>([]);
const message = ref('');
const modalOpen = ref(false);
const saving = ref(false);
const testingId = ref('');
const form = reactive({
  id: '',
  name: '',
  ipAddress: '',
  port: 9100,
  paperWidth: 80 as 58 | 80,
  usageType: 'GENERAL' as PrinterUsageType,
  encoding: 'UTF8' as PrinterEncoding,
  copies: 1,
  language: 'zh' as PrintLanguage,
  autoPrintEnabled: true,
  isDefault: true,
});

const title = computed(() => label({
  zh: '打印机管理',
  vi: 'Quản lý máy in',
  en: 'Printer Management',
}));

function label(labels: Record<'zh' | 'vi' | 'en', string>) {
  return labels[locale.value];
}

function reset() {
  Object.assign(form, {
    id: '',
    name: '',
    ipAddress: '',
    port: 9100,
    paperWidth: 80,
    usageType: 'GENERAL',
    encoding: 'UTF8',
    copies: 1,
    language: 'zh',
    autoPrintEnabled: true,
    isDefault: true,
  });
}

function openCreate() {
  reset();
  modalOpen.value = true;
}

function openEdit(row: PrinterSetting) {
  Object.assign(form, {
    id: row.id,
    name: row.name,
    ipAddress: row.ipAddress,
    port: row.port,
    paperWidth: row.paperWidth === 'WIDTH_58' ? 58 : 80,
    usageType: row.usageType,
    encoding: row.encoding,
    copies: row.copies,
    language: row.language,
    autoPrintEnabled: row.autoPrintEnabled,
    isDefault: row.isDefault,
  });
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  reset();
}

function payload(): PrinterPayload {
  return {
    name: form.name,
    ipAddress: form.ipAddress,
    port: Number(form.port),
    paperWidth: form.paperWidth,
    usageType: form.usageType,
    encoding: form.encoding,
    copies: Number(form.copies),
    language: form.language,
    autoPrintEnabled: form.autoPrintEnabled,
    isDefault: form.isDefault,
  };
}

async function load() {
  rows.value = await getPrinters();
}

async function save(options: { testAfterSave?: boolean } = {}) {
  try {
    saving.value = true;
    const saved = form.id
      ? await updatePrinter(form.id, payload())
      : await createPrinter(payload());
    await load();
    if (options.testAfterSave) {
      await runTest(saved.id);
    } else {
      message.value = label({ zh: '打印机已保存', vi: 'Đã lưu máy in', en: 'Printer saved' });
    }
    closeModal();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

async function remove(row: PrinterSetting) {
  if (!confirm(label({
    zh: `删除打印机“${row.name}”？`,
    vi: `Xóa máy in "${row.name}"?`,
    en: `Delete printer "${row.name}"?`,
  }))) return;
  try {
    await deletePrinter(row.id);
    await load();
    message.value = label({ zh: '打印机已删除', vi: 'Đã xóa máy in', en: 'Printer deleted' });
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function runTest(id: string) {
  try {
    testingId.value = id;
    const result = await testPrinter(id);
    await load();
    message.value = result.success
      ? label({ zh: '测试打印已发送', vi: 'Đã gửi lệnh in thử', en: 'Test print sent' })
      : result.errorMessage || label({ zh: '测试打印失败', vi: 'In thử thất bại', en: 'Test print failed' });
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    testingId.value = '';
  }
}

async function setDefault(row: PrinterSetting) {
  try {
    await updatePrinter(row.id, { isDefault: true });
    await load();
    message.value = label({ zh: '默认打印机已更新', vi: 'Đã cập nhật máy in mặc định', en: 'Default printer updated' });
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function statusLabel(row: PrinterSetting) {
  const labels = {
    UNKNOWN: { zh: '未测试', vi: 'Chưa kiểm tra', en: 'Untested' },
    ONLINE: { zh: '在线', vi: 'Online', en: 'Online' },
    OFFLINE: { zh: '离线', vi: 'Offline', en: 'Offline' },
  };
  return label(labels[row.status]);
}

function languageLabel(value: PrintLanguage) {
  const labels = {
    zh: '中文',
    vi: 'Tiếng Việt',
    en: 'English',
  };
  return labels[value];
}

function usageTypeLabel(value: PrinterUsageType) {
  const labels = {
    FRONT_DESK: { zh: '前台', vi: 'Quầy trước', en: 'Front Desk' },
    KITCHEN: { zh: '厨房', vi: 'Bếp', en: 'Kitchen' },
    BAR: { zh: '吧台', vi: 'Quầy bar', en: 'Bar' },
    GENERAL: { zh: '通用', vi: 'Chung', en: 'General' },
  };
  return label(labels[value]);
}

onMounted(() => load().catch((error) => (message.value = errorMessage(error))));
</script>

<template>
  <PageHeader :title="title" :description="label({ zh: '配置局域网网口小票打印机', vi: 'Cấu hình máy in hóa đơn mạng LAN', en: 'Configure LAN receipt printers' })">
    <button type="button" @click="openCreate">
      {{ label({ zh: '新增打印机', vi: 'Thêm máy in', en: 'Add Printer' }) }}
    </button>
  </PageHeader>

  <p class="message">{{ message }}</p>

  <div class="card table-wrap">
    <table>
      <thead>
        <tr>
          <th>{{ label({ zh: '打印机名称', vi: 'Tên máy in', en: 'Printer Name' }) }}</th>
          <th>{{ label({ zh: '连接方式', vi: 'Kết nối', en: 'Connection' }) }}</th>
          <th>{{ label({ zh: '用途', vi: 'Mục đích', en: 'Usage' }) }}</th>
          <th>{{ label({ zh: '地址', vi: 'Địa chỉ', en: 'Address' }) }}</th>
          <th>{{ label({ zh: '纸张', vi: 'Khổ giấy', en: 'Paper' }) }}</th>
          <th>{{ label({ zh: '语言', vi: 'Ngôn ngữ', en: 'Language' }) }}</th>
          <th>{{ label({ zh: '打印编码', vi: 'Mã hóa in', en: 'Print Encoding' }) }}</th>
          <th>{{ label({ zh: '自动打印', vi: 'Tự động in', en: 'Auto Print' }) }}</th>
          <th>{{ t('status') }}</th>
          <th>{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>
            <strong>{{ row.name }}</strong>
            <span v-if="row.isDefault" class="badge success">
              {{ label({ zh: '默认', vi: 'Mặc định', en: 'Default' }) }}
            </span>
          </td>
          <td>{{ label({ zh: '网络打印机', vi: 'Máy in mạng', en: 'Network printer' }) }}</td>
          <td>{{ usageTypeLabel(row.usageType) }}</td>
          <td>{{ row.ipAddress }}:{{ row.port }}</td>
          <td>{{ row.paperWidth === 'WIDTH_58' ? '58mm' : '80mm' }} × {{ row.copies }}</td>
          <td>{{ languageLabel(row.language) }}</td>
          <td>{{ row.encoding }}</td>
          <td>{{ row.autoPrintEnabled ? t('enabled') : t('disable') }}</td>
          <td>
            <span :class="['badge', row.status === 'ONLINE' ? 'success' : row.status === 'OFFLINE' ? 'danger-badge' : 'muted']">
              {{ statusLabel(row) }}
            </span>
          </td>
          <td class="actions">
            <button class="small secondary" @click="openEdit(row)">{{ t('edit') }}</button>
            <button class="small" :disabled="testingId === row.id" @click="runTest(row.id)">
              {{ label({ zh: '测试打印', vi: 'In thử', en: 'Test' }) }}
            </button>
            <button v-if="!row.isDefault" class="small secondary" @click="setDefault(row)">
              {{ label({ zh: '设为默认', vi: 'Đặt mặc định', en: 'Set Default' }) }}
            </button>
            <button class="small danger" @click="remove(row)">
              {{ label({ zh: '删除', vi: 'Xóa', en: 'Delete' }) }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="10" class="empty">
            {{ label({ zh: '暂无打印机', vi: 'Chưa có máy in', en: 'No printers yet' }) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="modalOpen" class="modal-backdrop" @click.self="closeModal">
    <form class="card printer-modal" @submit.prevent="save()">
      <div class="printer-modal-header">
        <h2>{{ form.id ? label({ zh: '编辑打印机', vi: 'Sửa máy in', en: 'Edit Printer' }) : label({ zh: '新增打印机', vi: 'Thêm máy in', en: 'Add Printer' }) }}</h2>
      </div>
      <div class="printer-modal-body">
        <label>{{ label({ zh: '打印机名称', vi: 'Tên máy in', en: 'Printer Name' }) }}<input v-model="form.name" required /></label>
        <label>{{ label({ zh: 'IP地址', vi: 'Địa chỉ IP', en: 'IP Address' }) }}<input v-model="form.ipAddress" required placeholder="192.168.1.100" /></label>
        <label>{{ label({ zh: '端口', vi: 'Cổng', en: 'Port' }) }}<input v-model.number="form.port" type="number" min="1" max="65535" required /></label>
        <label>
          {{ label({ zh: '用途', vi: 'Mục đích', en: 'Usage' }) }}
          <select v-model="form.usageType">
            <option value="FRONT_DESK">{{ label({ zh: '前台', vi: 'Quầy trước', en: 'Front Desk' }) }}</option>
            <option value="KITCHEN">{{ label({ zh: '厨房', vi: 'Bếp', en: 'Kitchen' }) }}</option>
            <option value="BAR">{{ label({ zh: '吧台', vi: 'Quầy bar', en: 'Bar' }) }}</option>
            <option value="GENERAL">{{ label({ zh: '通用', vi: 'Chung', en: 'General' }) }}</option>
          </select>
        </label>
        <label>
          {{ label({ zh: '小票宽度', vi: 'Khổ giấy', en: 'Paper Width' }) }}
          <select v-model.number="form.paperWidth">
            <option :value="58">58mm</option>
            <option :value="80">80mm</option>
          </select>
        </label>
        <label>{{ label({ zh: '打印份数', vi: 'Số bản in', en: 'Copies' }) }}<input v-model.number="form.copies" type="number" min="1" max="9" required /></label>
        <label>
          {{ label({ zh: '打印语言', vi: 'Ngôn ngữ in', en: 'Print Language' }) }}
          <select v-model="form.language">
            <option value="zh">中文</option>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          {{ label({ zh: '打印编码', vi: 'Mã hóa in', en: 'Print Encoding' }) }}
          <select v-model="form.encoding">
            <option value="UTF8">UTF8</option>
            <option value="GBK">GBK</option>
            <option value="CP1258">CP1258</option>
          </select>
        </label>
        <label class="check-row"><input v-model="form.autoPrintEnabled" type="checkbox" />{{ label({ zh: '自动打印', vi: 'Tự động in', en: 'Auto Print' }) }}</label>
        <label class="check-row"><input v-model="form.isDefault" type="checkbox" />{{ label({ zh: '默认打印机', vi: 'Máy in mặc định', en: 'Default Printer' }) }}</label>
      </div>
      <div class="printer-modal-footer">
        <div class="actions modal-actions">
          <button type="button" class="secondary" @click="closeModal">{{ t('cancel') }}</button>
          <button type="submit" :disabled="saving">{{ t('saveChanges') }}</button>
          <button type="button" :disabled="saving" @click="save({ testAfterSave: true })">
            {{ label({ zh: '保存并测试打印', vi: 'Lưu và in thử', en: 'Save and Test' }) }}
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgb(17 24 39 / 42%);
}

.printer-modal {
  width: min(560px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
}

.printer-modal h2 {
  margin: 0;
}

.printer-modal-header {
  flex: 0 0 auto;
  padding: 4px 0 12px;
  border-bottom: 1px solid #e5e7eb;
}

.printer-modal-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 14px 2px 16px;
  display: grid;
  gap: 10px;
  min-height: 0;
}

.printer-modal-footer {
  flex: 0 0 auto;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
}

.check-row input {
  width: auto;
}

.modal-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.danger-badge {
  color: #b42318;
  background: #fee4e2;
}

.printer-modal label {
  display: grid;
  gap: 6px;
}

.printer-modal input,
.printer-modal select {
  min-width: 0;
}

@media (max-width: 640px) {
  .modal-backdrop {
    padding: 8px;
    align-items: flex-end;
  }

  .printer-modal {
    width: 100%;
    max-height: 90vh;
  }

  .printer-modal-body {
    padding-right: 4px;
  }

  .modal-actions {
    justify-content: stretch;
  }

  .modal-actions button {
    flex: 1 1 100%;
  }
}
</style>
