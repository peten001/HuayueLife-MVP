<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import MerchantDialog from '@/components/MerchantDialog.vue';
import MerchantIcon from '@/components/MerchantIcon.vue';
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

const { t, locale } = useI18n();
const word = (zh:string,vi:string,en:string) => locale.value === 'zh' ? zh : locale.value === 'vi' ? vi : en;
const message = ref('');
const staffList = ref<MerchantStaffListItem[]>([]);
const busyId = ref('');
const showForm = ref(false);
const editing = ref(false);
const resetPasswordValue = ref('');
const selectedStaff = ref<MerchantStaffListItem | null>(null);
const openActionMenuId = ref('');
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
  document.addEventListener('pointerdown', onDocumentPointerDown);
  await refresh();
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
});

function closeActionMenus() {
  openActionMenuId.value = '';
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest('.mx-action-menu')) return;
  closeActionMenus();
}

function onActionMenuToggle(itemId: string, event: Event) {
  const menu = event.currentTarget as HTMLDetailsElement;
  if (menu.open) {
    openActionMenuId.value = itemId;
  } else if (openActionMenuId.value === itemId) {
    openActionMenuId.value = '';
  }
}

async function refresh() {
  try {
    staffList.value = await getStaffList();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function openCreate() {
  message.value = '';
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
  closeActionMenus();
  message.value = '';
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
  closeActionMenus();
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
  closeActionMenus();
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
  <section class="mx-staff">
    <header class="mx-heading mx-management-heading"><div><h1>{{ t('staffManagement') }}</h1><p>{{ word('管理团队成员及后台访问权限','Quản lý đội ngũ và quyền truy cập','Manage your team and access') }}</p></div><button type="button" @click="openCreate"><MerchantIcon name="plus" />{{ t('addStaff') }}</button></header>
    <p v-if="message" class="message" role="status">{{ message }}</p>
    <section v-if="resetPasswordValue" class="mx-panel mx-password-result"><strong>{{ t('temporaryPassword') }}</strong><code>{{ resetPasswordValue }}</code><button class="secondary" type="button" @click="copyPassword">{{ t('copyPassword') }}</button></section>
    <section class="mx-panel mx-team-directory">
      <header class="mx-panel-heading"><h2>{{ word('团队成员','Thành viên','Team members') }}</h2><span>{{ staffList.filter(item=>item.status==='ACTIVE').length }} {{ word('位已启用','đang hoạt động','active') }}</span></header>
      <article v-for="item in staffList" :key="item.id" class="mx-team-row">
        <div class="mx-person"><span class="mx-avatar" aria-hidden="true">{{ item.displayName.slice(0,1) }}</span><div><strong>{{ item.displayName }}</strong><small>{{ item.username }}</small></div></div>
        <div class="mx-team-role"><strong>{{ roleLabel(item) }}</strong><span :class="['mx-dot-status',{'is-active':item.status==='ACTIVE'}]">{{ statusLabel(item) }}</span></div>
        <div class="mx-team-meta">
          <dl class="mx-team-dates"><div><dt>{{ t('lastLoginAt') }}</dt><dd>{{ lastLoginLabel(item) }}</dd></div><div><dt>{{ t('createdAt') }}</dt><dd>{{ new Date(item.createdAt).toLocaleDateString() }}</dd></div></dl>
          <div v-if="item.role!=='OWNER'" class="mx-team-actions"><details class="mx-action-menu" :open="openActionMenuId===item.id" @toggle="onActionMenuToggle(item.id,$event)"><summary role="button" aria-haspopup="menu" :aria-expanded="openActionMenuId===item.id" :aria-label="word('更多员工操作','Thao tác khác','More staff actions')"><MerchantIcon name="ellipsis" /></summary><div role="menu"><button type="button" class="secondary" role="menuitem" @click="openEdit(item)">{{ t('edit') }}</button><button type="button" class="secondary" role="menuitem" :disabled="busyId===item.id" @click="onResetPassword(item)">{{ t('resetStaffPassword') }}</button><button type="button" class="danger" role="menuitem" :disabled="busyId===item.id" @click="onDisable(item)">{{ t('disable') }}</button></div></details></div>
          <span v-else class="mx-team-owner">{{ word('店主账户','Chủ cửa hàng','Owner account') }}</span>
        </div>
      </article>
      <div v-if="!staffList.length" class="m-empty"><MerchantIcon name="staff" /><p>{{ word('暂无员工','Chưa có nhân viên','No team members') }}</p><button class="secondary" type="button" @click="openCreate">{{ t('addStaff') }}</button></div>
    </section>
    <MerchantDialog :open="showForm" :title="editing?t('editStaff'):t('addStaff')" @close="closeForm">
      <form class="mx-form" @submit.prevent="submit"><p v-if="message" class="mx-form-error" role="alert">{{ message }}</p><div class="mx-form-section"><label>{{ t('displayName') }}<input v-model="form.displayName" required maxlength="64" autocomplete="name" /></label><label>{{ t('loginPhone') }}<input v-model="form.username" :disabled="editing" :placeholder="t('staffPhonePlaceholder')" required maxlength="15" pattern="^\+?\d{8,15}$" inputmode="tel" autocomplete="username" /></label><label v-if="!editing">{{ t('password') }}<input v-model="form.password" required type="password" minlength="8" autocomplete="new-password" /></label><label v-if="selectedRoleOptions.length">{{ t('role') }}<select v-model="form.role"><option v-for="option in selectedRoleOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label></div><div class="mx-editor-actions"><button type="button" class="secondary" @click="closeForm">{{ t('cancel') }}</button><button type="submit">{{ editing?t('saveChanges'):t('createStaff') }}</button></div></form>
    </MerchantDialog>
  </section>
</template>
