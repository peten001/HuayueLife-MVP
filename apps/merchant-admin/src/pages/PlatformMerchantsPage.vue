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
import { useI18n, type TranslationKey } from '@/i18n';
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
  homepageCategoryKeys: [] as string[],
  manualPopular: false,
});

const isEditing = computed(() => dialogMode.value === 'edit');
const homepageCategoryOptions = computed(() => [
  { value: 'chinese', label: t('homepageCategoryChinese') },
  { value: 'noodles', label: t('homepageCategoryNoodles') },
  { value: 'drinks', label: t('homepageCategoryDrinks') },
]);

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
  form.homepageCategoryKeys = [];
  form.manualPopular = false;
  dialogVisible.value = true;
  message.value = '';
}

function openEdit(item: PlatformMerchantListItem) {
  dialogMode.value = 'edit';
  editingId.value = item.id;
  form.nameZh = item.nameZh;
  form.contactPhone = item.contactPhone;
  form.homepageCategoryKeys = [...(item.homepageCategoryKeys ?? [])];
  form.manualPopular = Boolean(item.manualPopular);
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
      const phone = form.contactPhone.trim();
      await createPlatformMerchant({
        phone,
        homepageCategoryKeys: [...form.homepageCategoryKeys],
        manualPopular: form.manualPopular,
      });
      message.value = `${t('merchantCreated')}\n${t('username')}：${phone}\n${t('password')}：12345678\n${t('mustChangePassword')}`;
    } else {
      await updatePlatformMerchant(editingId.value, {
        nameZh: form.nameZh,
        contactPhone: form.contactPhone,
        homepageCategoryKeys: [...form.homepageCategoryKeys],
        manualPopular: form.manualPopular,
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

function missingProfileText(item: PlatformMerchantListItem) {
  if (!item.missingProfileFields.length) return '';
  return item.missingProfileFields.map((key) => t(key as TranslationKey)).join('、');
}

function toggleHomepageCategory(value: string) {
  if (form.homepageCategoryKeys.includes(value)) {
    form.homepageCategoryKeys = form.homepageCategoryKeys.filter((item) => item !== value);
    return;
  }
  form.homepageCategoryKeys = [...form.homepageCategoryKeys, value];
}

function homepageCategoryText(keys: string[]) {
  const labels = homepageCategoryOptions.value
    .filter((item) => keys.includes(item.value))
    .map((item) => item.label);
  return labels.length ? labels.join('、') : '-';
}

function regionText(item: PlatformMerchantListItem) {
  return [item.city, item.district].filter(Boolean).join(' / ') || '-';
}

function money(value: string | number) {
  return `${Number(value).toLocaleString()} ₫`;
}

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
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
      <label v-if="isEditing" class="span-2">{{ t('chineseName') }}<input v-model="form.nameZh" required maxlength="120" /></label>
      <label class="span-2">{{ t('contactPhone') }}<input v-model="form.contactPhone" required maxlength="32" /></label>
      <section class="span-2">
        <strong>{{ t('homepageCategories') }}</strong>
        <p class="hint">{{ t('homepageCategoriesHint') }}</p>
        <div class="actions-line">
          <label
            v-for="item in homepageCategoryOptions"
            :key="item.value"
            class="check"
          >
            <input
              type="checkbox"
              :checked="form.homepageCategoryKeys.includes(item.value)"
              @change="toggleHomepageCategory(item.value)"
            />
            {{ item.label }}
          </label>
        </div>
      </section>
      <label class="span-2 check">
        <input v-model="form.manualPopular" type="checkbox" />
        <span>{{ t('manualPopular') }}</span>
      </label>
      <p class="span-2 hint">{{ t('manualPopularHint') }}</p>
      <p v-if="!isEditing" class="span-2 hint">{{ t('merchantNameAutoGenerated') }}</p>
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
          <th>{{ t('merchantName') }}</th>
          <th>城市 / 区域</th>
          <th>营业状态</th>
          <th>{{ t('homepageCategories') }}</th>
          <th>{{ t('manualPopular') }}</th>
          <th>今日订单</th>
          <th>待接单</th>
          <th>今日订单金额</th>
          <th>近 7 日订单</th>
          <th>最近订单时间</th>
          <th>{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in merchants" :key="item.id">
          <td>
            {{ item.nameZh }}
            <small>{{ item.contactPhone }}</small>
            <small>{{ item.ownerUsername }} · {{ item.ownerMustChangePassword ? t('mustChangePassword') : t('passwordReady') }}</small>
            <small :title="missingProfileText(item)">
              {{ t('profileCompletion') }} {{ item.profileCompletion }}%
            </small>
          </td>
          <td>{{ regionText(item) }}</td>
          <td><span class="badge" :class="item.status === 'ACTIVE' ? 'success' : item.status === 'DISABLED' ? 'warning-badge' : 'muted'">{{ statusLabel(item.status) }}</span></td>
          <td>{{ homepageCategoryText(item.homepageCategoryKeys) }}</td>
          <td>{{ item.manualPopular ? t('enabled') : '-' }}</td>
          <td>
            <strong>{{ item.todayOrderCount }}</strong>
          </td>
          <td>{{ item.pendingAcceptanceOrderCount }}</td>
          <td>{{ money(item.todayOrderAmount) }}</td>
          <td>{{ item.last7DaysOrderCount }}</td>
          <td>{{ dateTime(item.lastOrderAt) }}</td>
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
