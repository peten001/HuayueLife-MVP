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

function roleLabel(item: MerchantStaffListItem) {
  return t(item.role === 'MANAGER' ? 'managerRole' : item.role === 'STAFF' ? 'staffRole' : 'ownerRole');
}

function statusLabel(item: MerchantStaffListItem) {
  return item.status === 'ACTIVE' ? t('activeStatus') : t('disabledStatus');
}

function lastLoginLabel(item: MerchantStaffListItem) {
  return item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString() : t('none');
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

  <section class="card table-wrap staff-desktop-table">
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
          <td>{{ roleLabel(item) }}</td>
          <td>{{ statusLabel(item) }}</td>
          <td>{{ lastLoginLabel(item) }}</td>
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
            <span v-else>{{ t('none') }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="staff-mobile-list" :aria-label="t('staffManagement')">
    <article v-for="item in staffList" :key="item.id" class="card staff-mobile-card">
      <header>
        <div><strong>{{ item.displayName }}</strong><span>{{ item.username }}</span></div>
        <div class="staff-pills"><span class="staff-role">{{ roleLabel(item) }}</span><span class="staff-status" :class="{ 'is-active': item.status === 'ACTIVE' }">{{ statusLabel(item) }}</span></div>
      </header>
      <dl>
        <div><dt>{{ t('lastLoginAt') }}</dt><dd>{{ lastLoginLabel(item) }}</dd></div>
      </dl>
      <footer v-if="item.role !== 'OWNER'" class="staff-mobile-actions">
        <button class="secondary" type="button" @click="openEdit(item)">{{ t('edit') }}</button>
        <button class="danger" type="button" :disabled="busyId === item.id" @click="onDisable(item)">{{ t('disable') }}</button>
        <button type="button" :disabled="busyId === item.id" @click="onResetPassword(item)">{{ t('resetStaffPassword') }}</button>
      </footer>
    </article>
  </section>
</template>

<style scoped>
.staff-mobile-list { display: none; }

@media (max-width: 768px) {
  :deep(.page-header) { align-items: center; flex-direction: row; gap: 10px; margin: 4px 0 12px; }
  :deep(.page-header h1) { font-size: 22px; }
  :deep(.page-header button) { min-height: 44px; padding: 9px 13px; white-space: nowrap; }
  .form-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .form-actions { align-items: stretch; flex-direction: column; }
  .form-actions button { min-height: 44px; }
  .staff-desktop-table { display: none; }
  .staff-mobile-list { display: grid; gap: 10px; }
  .staff-mobile-card { display: grid; min-width: 0; gap: 12px; padding: 14px; border-radius: 14px; box-shadow: 0 3px 12px rgb(31 45 36 / 5%); }
  .staff-mobile-card header { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .staff-mobile-card header>div { display: grid; min-width: 0; gap: 3px; }
  .staff-mobile-card header strong { overflow: hidden; color: #1f2d24; font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }
  .staff-mobile-card header>div:first-child span { overflow: hidden; color: #6d7b72; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .staff-pills { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 5px; }
  .staff-role { padding: 5px 8px; border-radius: 999px; color: #315783; background: #eaf2fb; font-size: 11px; font-weight: 750; white-space: nowrap; }
  .staff-status { flex: 0 0 auto; padding: 5px 8px; border-radius: 999px; color: #8a4f31; background: #fff0e6; font-size: 11px; font-weight: 750; white-space: nowrap; }
  .staff-status.is-active { color: #17693c; background: #e5f5ec; }
  .staff-mobile-card dl { display: grid; gap: 8px; margin: 0; padding: 10px 0; border-top: 1px solid #edf1ee; border-bottom: 1px solid #edf1ee; }
  .staff-mobile-card dl div { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 10px; }
  .staff-mobile-card dt { color: #6d7b72; font-size: 12px; }
  .staff-mobile-card dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #26372d; font-size: 13px; font-weight: 650; text-align: right; }
  .staff-mobile-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .staff-mobile-actions button { min-width: 0; min-height: 44px; padding: 8px 9px; white-space: nowrap; }
  .staff-mobile-actions button:last-child:nth-child(odd) { grid-column: 1 / -1; }
}
</style>
