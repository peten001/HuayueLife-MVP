<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n } from '@/i18n';
import { getProfile, updateProfile } from '@/api/merchant';

const form = reactive({
  dineInEnabled: true,
  pickupEnabled: true,
  deliveryEnabled: false,
  minimumDeliveryAmountVnd: 0,
  deliveryFeeVnd: 0,
  deliveryRadiusKm: 0,
  businessHoursText: '{}',
});
const { t } = useI18n();
const message = ref('');

onMounted(async () => {
  try {
    const profile = await getProfile();
    Object.assign(form, {
      dineInEnabled: profile.dineInEnabled,
      pickupEnabled: profile.pickupEnabled,
      deliveryEnabled: profile.deliveryEnabled,
      minimumDeliveryAmountVnd: Number(profile.minimumDeliveryAmountVnd),
      deliveryFeeVnd: Number(profile.deliveryFeeVnd),
      deliveryRadiusKm: Number(profile.deliveryRadiusKm),
      businessHoursText: JSON.stringify(profile.businessHours, null, 2),
    });
  } catch (error) {
    message.value = errorMessage(error);
  }
});

async function save() {
  message.value = '';

  if (
    typeof form.deliveryRadiusKm !== 'number' ||
    !Number.isFinite(form.deliveryRadiusKm)
  ) {
    message.value = t('invalidDeliveryRadius');
    return;
  }

  let businessHours: unknown;
  try {
    businessHours = JSON.parse(form.businessHoursText);
  } catch {
    message.value = t('invalidBusinessHoursJson');
    return;
  }

  if (
    businessHours === null ||
    typeof businessHours !== 'object' ||
    Array.isArray(businessHours)
  ) {
    message.value = t('invalidBusinessHoursObject');
    return;
  }

  try {
    await updateProfile({
      dineInEnabled: form.dineInEnabled,
      pickupEnabled: form.pickupEnabled,
      deliveryEnabled: form.deliveryEnabled,
      minimumDeliveryAmountVnd: form.minimumDeliveryAmountVnd,
      deliveryFeeVnd: form.deliveryFeeVnd,
      deliveryRadiusKm: form.deliveryRadiusKm,
      businessHours,
    });
    message.value = t('settingsSaved');
  } catch (error) {
    message.value = errorMessage(error);
  }
}
</script>

<template>
  <PageHeader :title="t('businessSettings')" :description="t('businessDescription')" />
  <form class="card form-grid" @submit.prevent="save">
    <label class="check"><input v-model="form.dineInEnabled" type="checkbox" />{{ t('dineIn') }}</label>
    <label class="check"><input v-model="form.pickupEnabled" type="checkbox" />{{ t('pickup') }}</label>
    <label class="check"><input v-model="form.deliveryEnabled" type="checkbox" />{{ t('delivery') }}</label>
    <span />
    <label>{{ t('minimumDeliveryAmount') }}<input v-model.number="form.minimumDeliveryAmountVnd" type="number" min="0" /></label>
    <label>{{ t('deliveryFeeVnd') }}<input v-model.number="form.deliveryFeeVnd" type="number" min="0" /></label>
    <label>{{ t('deliveryRadius') }}<input v-model.number="form.deliveryRadiusKm" type="number" min="0" max="100" step="0.1" /></label>
    <label class="span-2">
      {{ t('businessHoursJson') }}
      <textarea v-model="form.businessHoursText" rows="14" spellcheck="false" />
    </label>
    <div class="form-actions span-2">
      <span class="message">{{ message }}</span>
      <button>{{ t('saveSettings') }}</button>
    </div>
  </form>
</template>
