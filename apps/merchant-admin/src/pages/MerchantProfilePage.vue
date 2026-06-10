<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getProfile, updateProfile } from '@/api/merchant';

const form = reactive({
  nameZh: '',
  nameVi: '',
  contactName: '',
  contactPhone: '',
  province: '',
  city: '',
  district: '',
  addressDetail: '',
  latitude: 0,
  longitude: 0,
  logoUrl: '',
  coverUrl: '',
  notice: '',
});
const message = ref('');

onMounted(async () => {
  try {
    Object.assign(form, await getProfile());
  } catch (error) {
    message.value = errorMessage(error);
  }
});

async function save() {
  try {
    await updateProfile({
      ...form,
      logoUrl: form.logoUrl || undefined,
      coverUrl: form.coverUrl || undefined,
    });
    message.value = '商家资料已保存';
  } catch (error) {
    message.value = errorMessage(error);
  }
}
</script>

<template>
  <PageHeader title="商家资料" description="维护餐厅联系人、地址和地图坐标" />
  <form class="card form-grid" @submit.prevent="save">
    <label>中文名称<input v-model="form.nameZh" required maxlength="120" /></label>
    <label>越南语名称<input v-model="form.nameVi" maxlength="120" /></label>
    <label>联系人<input v-model="form.contactName" required /></label>
    <label>联系电话<input v-model="form.contactPhone" required /></label>
    <label>省<input v-model="form.province" required /></label>
    <label>城市<input v-model="form.city" required /></label>
    <label>区县<input v-model="form.district" /></label>
    <label class="span-2">详细地址<input v-model="form.addressDetail" required /></label>
    <label>纬度<input v-model.number="form.latitude" type="number" step="0.0000001" required /></label>
    <label>经度<input v-model.number="form.longitude" type="number" step="0.0000001" required /></label>
    <label class="span-2">Logo URL<input v-model="form.logoUrl" type="url" /></label>
    <label class="span-2">封面 URL<input v-model="form.coverUrl" type="url" /></label>
    <label class="span-2">商家公告<textarea v-model="form.notice" rows="4" /></label>
    <div class="form-actions span-2">
      <span class="message">{{ message }}</span>
      <button>保存资料</button>
    </div>
  </form>
</template>
