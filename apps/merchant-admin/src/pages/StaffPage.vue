<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n } from '@/i18n';
import {
  createStaff,
  disableStaff,
  getStaffList,
  resetStaffPassword,
  updateStaff,
} from '@/api/merchant';
import type { MerchantStaffListItem, MerchantStaffRole } from '@/types/api';

type StaffForm = {
  id: string;
  username: string;
  displayName: string;
  password: string;
  role: Exclude<MerchantStaffRole, 'OWNER'>;
};

const { t } = useI18n();
const message = ref('');
const staffList = ref<MerchantStaffListItem[]>([]);
const busyId = ref('');
const showForm = ref(false);
const editing = ref(false);
const resetPasswordValue = ref('');
const selectedStaff = ref<MerchantStaffListItem | null>(null);
const phonePattern = /^\+?\d{8,15}$/;

const form = reactive<StaffForm>({
  id: '',
  username: '',
  displayName: '',
  password: '',
  role: 'STAFF',
});

const roleOptions = computed(() => [
  { value: 'MANAGER' as const, label: t('managerRole') },
  { value: 'STAFF' as const, label: t('staffRole') },
]);

const selectedRoleOptions = computed(() => {
  if (editing.value && selectedStaff.value?.role === 'OWNER') {
    return [];
  }
  return roleOptions.value;
});

onMounted(async () => {
  await refresh();
});

async function refresh() {
  try {
    staffList.value = await getStaffList();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function openCreate() {
  editing.value = false;
  selectedStaff.value = null;
  resetPasswordValue.value = '';
  Object.assign(form, {
    id: '',
    username: '',
    displayName: '',
    password: '',
    role: 'STAFF',
  });
  showForm.value = true;
}

function openEdit(item: MerchantStaffListItem) {
  editing.value = true;
  selectedStaff.value = item;
  Object.assign(form, {
    id: item.id,
    username: item.username,
    displayName: item.displayName,
    password: '',
    role: item.role === 'OWNER' ? 'STAFF' : item.role,
  });
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
}

async function submit() {
  message.value = '';
  if (!editing.value && !phonePattern.test(form.username.trim())) {
    message.value = t('invalidStaffPhone');
    return;
  }
  try {
    if (!editing.value) {
      await createStaff({
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        password: form.password,
        role: form.role,
      });
      message.value = t('staffCreated');
    } else {
      await updateStaff(
        form.id,
        selectedStaff.value?.role === 'OWNER'
          ? { displayName: form.displayName.trim() }
          : {
              displayName: form.displayName.trim(),
              role: form.role,
            },
      );
      message.value = t('staffUpdated');
    }
    closeForm();
    await refresh();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function onDisable(item: MerchantStaffListItem) {
  if (!confirm(t('disableStaffConfirm', { name: item.displayName }))) return;
  busyId.value = item.id;
  try {
    await disableStaff(item.id);
    message.value = t('staffDisabled');
    await refresh();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    busyId.value = '';
  }
}

async function onResetPassword(item: MerchantStaffListItem) {
  if (!confirm(t('resetStaffPasswordConfirm', { name: item.displayName }))) return;
  busyId.value = item.id;
  try {
    const result = await resetStaffPassword(item.id);
    resetPasswordValue.value = result.newPassword;
    message.value = t('staffPasswordReset');
    await refresh();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    busyId.value = '';
  }
}

async function copyPassword() {
  if (!resetPasswordValue.value) return;
  await navigator.clipboard?.writeText(resetPasswordValue.value);
}
</script>

<template>
  <PageHeader :title="t('staffManagement')">
    <button @click="openCreate">{{ t('addStaff') }}</button>
  </PageHeader>

  <section class="card" v-if="resetPasswordValue">
    <strong>{{ t('temporaryPassword') }}:</strong>
    <code>{{ resetPasswordValue }}</code>
    <button class="small secondary" type="button" @click="copyPassword">
      {{ t('copyPassword') }}
    </button>
  </section>

  <section class="card" v-if="showForm">
    <h3>{{ editing ? t('editStaff') : t('addStaff') }}</h3>
    <div class="form-grid">
      <label>
        {{ t('loginPhone') }}
        <input
          v-model="form.username"
          :disabled="editing"
          :placeholder="t('staffPhonePlaceholder')"
          required
          maxlength="15"
          pattern="^\+?\d{8,15}$"
          inputmode="tel"
        />
      </label>
      <label>
        {{ t('displayName') }}
        <input v-model="form.displayName" required maxlength="64" />
      </label>
      <label>
        {{ t('password') }}
        <input v-model="form.password" :required="!editing" :disabled="editing" type="password" minlength="8" />
      </label>
      <label>
        {{ t('role') }}
        <select v-model="form.role">
          <option v-for="option in selectedRoleOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>
    <div class="form-actions">
      <button type="button" @click="submit">{{ editing ? t('saveChanges') : t('createStaff') }}</button>
      <button class="secondary" type="button" @click="closeForm">{{ t('cancel') }}</button>
    </div>
  </section>

  <p class="message">{{ message }}</p>

  <section class="card table-wrap">
    <table>
      <thead>
        <tr>
          <th>{{ t('username') }}</th>
          <th>{{ t('displayName') }}</th>
          <th>{{ t('role') }}</th>
          <th>{{ t('status') }}</th>
          <th>{{ t('lastLoginAt') }}</th>
          <th>{{ t('createdAt') }}</th>
          <th>{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in staffList" :key="item.id">
          <td>{{ item.username }}</td>
          <td>{{ item.displayName }}</td>
          <td>{{ t(item.role === 'MANAGER' ? 'managerRole' : item.role === 'STAFF' ? 'staffRole' : 'ownerRole') }}</td>
          <td>{{ item.status === 'ACTIVE' ? t('activeStatus') : t('disabledStatus') }}</td>
          <td>{{ item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString() : t('none') }}</td>
          <td>{{ new Date(item.createdAt).toLocaleString() }}</td>
          <td class="actions">
            <template v-if="item.role !== 'OWNER'">
              <button class="small secondary" @click="openEdit(item)">{{ t('edit') }}</button>
              <button class="small danger" :disabled="busyId === item.id" @click="onDisable(item)">
                {{ t('disable') }}
              </button>
              <button class="small" :disabled="busyId === item.id" @click="onResetPassword(item)">
                {{ t('resetStaffPassword') }}
              </button>
            </template>
            <span v-else>—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
