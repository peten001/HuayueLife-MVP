<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
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
  try {
    const businessHours = JSON.parse(form.businessHoursText);
    await updateProfile({
      dineInEnabled: form.dineInEnabled,
      pickupEnabled: form.pickupEnabled,
      deliveryEnabled: form.deliveryEnabled,
      minimumDeliveryAmountVnd: form.minimumDeliveryAmountVnd,
      deliveryFeeVnd: form.deliveryFeeVnd,
      deliveryRadiusKm: form.deliveryRadiusKm,
      businessHours,
    });
    message.value = '营业设置已保存';
  } catch (error) {
    message.value = errorMessage(error);
  }
}
</script>

<template>
  <PageHeader title="营业设置" description="V1 支持堂食、自取和商家自行配送" />
  <form class="card form-grid" @submit.prevent="save">
    <label class="check"><input v-model="form.dineInEnabled" type="checkbox" />堂食</label>
    <label class="check"><input v-model="form.pickupEnabled" type="checkbox" />到店自取</label>
    <label class="check"><input v-model="form.deliveryEnabled" type="checkbox" />商家配送</label>
    <span />
    <label>配送起送价（VND）<input v-model.number="form.minimumDeliveryAmountVnd" type="number" min="0" /></label>
    <label>配送费（VND）<input v-model.number="form.deliveryFeeVnd" type="number" min="0" /></label>
    <label>配送半径（公里）<input v-model.number="form.deliveryRadiusKm" type="number" min="0" max="100" step="0.1" /></label>
    <label class="span-2">
      营业时间 JSON
      <textarea v-model="form.businessHoursText" rows="14" spellcheck="false" />
    </label>
    <div class="form-actions span-2">
      <span class="message">{{ message }}</span>
      <button>保存设置</button>
    </div>
  </form>
</template>
