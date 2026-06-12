<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createPlatformMerchant,
  deletePlatformMerchant,
  disablePlatformMerchant,
  enablePlatformMerchant,
  getPlatformMerchants,
  resetPlatformMerchantPassword,
  updatePlatformMerchant,
} from '@/api/platform';
import { useI18n } from '@/i18n';
import type { PlatformMerchantListItem } from '@/types/api';

const { t } = useI18n();
const merchants = ref<PlatformMerchantListItem[]>([]);
const loading = ref(false);
const message = ref('');
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref('');
const form = reactive({
  nameZh: '',
  contactPhone: '',
});

const isEditing = computed(() => dialogMode.value === 'edit');

onMounted(loadMerchants);

async function loadMerchants() {
  loading.value = true;
  message.value = '';
  try {
    merchants.value = await getPlatformMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  dialogMode.value = 'create';
  editingId.value = '';
  form.nameZh = '';
  form.contactPhone = '';
  dialogVisible.value = true;
  message.value = '';
}

function openEdit(item: PlatformMerchantListItem) {
  dialogMode.value = 'edit';
  editingId.value = item.id;
  form.nameZh = item.nameZh;
  form.contactPhone = item.contactPhone;
  dialogVisible.value = true;
  message.value = '';
}

function closeDialog() {
  dialogVisible.value = false;
}

async function submit() {
  message.value = '';
  try {
    if (dialogMode.value === 'create') {
      await createPlatformMerchant({
        nameZh: form.nameZh,
        contactPhone: form.contactPhone,
      });
      message.value = t('merchantCreated');
    } else {
      await updatePlatformMerchant(editingId.value, {
        nameZh: form.nameZh,
        contactPhone: form.contactPhone,
      });
      message.value = t('merchantUpdated');
    }
    dialogVisible.value = false;
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function resetPassword(item: PlatformMerchantListItem) {
  if (!window.confirm(t('resetMerchantPasswordConfirm', { name: item.nameZh }))) {
    return;
  }
  try {
    await resetPlatformMerchantPassword(item.id);
    message.value = t('merchantPasswordReset');
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function toggleStatus(item: PlatformMerchantListItem) {
  const isActive = item.status === 'ACTIVE';
  const confirmed = window.confirm(
    isActive
      ? t('disableMerchantConfirm', { name: item.nameZh })
      : t('enableMerchantConfirm', { name: item.nameZh }),
  );
  if (!confirmed) return;
  try {
    if (isActive) {
      await disablePlatformMerchant(item.id);
      message.value = t('merchantDisabled');
    } else {
      await enablePlatformMerchant(item.id);
      message.value = t('merchantEnabled');
    }
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function removeMerchant(item: PlatformMerchantListItem) {
  if (!window.confirm(t('deleteMerchantConfirm', { name: item.nameZh }))) {
    return;
  }
  try {
    await deletePlatformMerchant(item.id);
    message.value = t('merchantDeleted');
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function statusLabel(status: PlatformMerchantListItem['status']) {
  if (status === 'ACTIVE') return t('activeStatus');
  if (status === 'DISABLED') return t('disabledStatus');
  if (status === 'DELETED') return t('deletedStatus');
  return t('pendingStatus');
}
</script>

<template>
  <PageHeader :title="t('merchantManagement')" :description="t('platformMerchantDescription')">
    <button @click="openCreate">{{ t('createMerchant') }}</button>
  </PageHeader>

  <p v-if="message" class="message">{{ message }}</p>

  <div v-if="dialogVisible" class="modal-backdrop" @click.self="closeDialog">
    <form class="card modal-card form-grid" @submit.prevent="submit">
      <h2>{{ isEditing ? t('editMerchant') : t('createMerchant') }}</h2>
      <label class="span-2">{{ t('chineseName') }}<input v-model="form.nameZh" required maxlength="120" /></label>
      <label class="span-2">{{ t('contactPhone') }}<input v-model="form.contactPhone" required maxlength="32" /></label>
      <p class="span-2 hint">{{ t('defaultPasswordHint') }}</p>
      <div class="form-actions span-2">
        <button class="secondary" type="button" @click="closeDialog">{{ t('cancel') }}</button>
        <button type="submit">{{ t('saveChanges') }}</button>
      </div>
    </form>
  </div>

  <div class="card table-wrap">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>{{ t('merchantName') }}</th>
          <th>{{ t('contactPhone') }}</th>
          <th>{{ t('status') }}</th>
          <th>{{ t('ownerAccount') }}</th>
          <th>{{ t('createdAt') }}</th>
          <th>{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in merchants" :key="item.id">
          <td>{{ item.id }}</td>
          <td>
            {{ item.nameZh }}
            <small>{{ item.ownerMustChangePassword ? t('mustChangePassword') : t('passwordReady') }}</small>
          </td>
          <td>{{ item.contactPhone }}</td>
          <td><span class="badge" :class="item.status === 'ACTIVE' ? 'success' : item.status === 'DISABLED' ? 'warning-badge' : 'muted'">{{ statusLabel(item.status) }}</span></td>
          <td>
            {{ item.ownerUsername }}
            <small>{{ item.ownerStatus === 'ACTIVE' ? t('activeStatus') : t('disabledStatus') }}</small>
          </td>
          <td>{{ new Date(item.createdAt).toLocaleString() }}</td>
          <td>
            <div class="actions">
              <button class="small secondary" @click="openEdit(item)">{{ t('edit') }}</button>
              <button class="small secondary" @click="resetPassword(item)">{{ t('resetPassword') }}</button>
              <button class="small warning" @click="toggleStatus(item)">{{ item.status === 'ACTIVE' ? t('disable') : t('enabled') }}</button>
              <button class="small danger" @click="removeMerchant(item)">{{ t('deleteMerchant') }}</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!loading && merchants.length === 0" class="empty">{{ t('noMatchingMerchants') }}</p>
  </div>
</template>
