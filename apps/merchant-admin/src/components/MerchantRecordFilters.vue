<script setup lang="ts">
import { useI18n, type TranslationKey } from '@/i18n';
import MerchantIcon from './MerchantIcon.vue';
defineProps<{ filters: { search: string; type: string; status: string; abnormal: boolean }; settlementsMode: boolean; loading: boolean; typeOptions: Array<[string, TranslationKey]>; statusOptions: Array<[string, TranslationKey]> }>();
defineEmits<{ apply: [] }>();
const { locale, t } = useI18n();
function word(zh: string, vi: string, en: string) { return ({ zh, vi, en })[locale.value]; }
</script>
<template>
  <form class="mx-record-filters" @submit.prevent="$emit('apply')">
    <label class="mx-search-field"><span>{{ word('搜索记录','Tìm bản ghi','Search records') }}</span><div><MerchantIcon name="search" /><input v-model="filters.search" type="search" :placeholder="settlementsMode ? word('订单号或订单 ID','Mã đơn hoặc ID đơn','Order number or order ID') : word('订单号、桌号、顾客','Mã đơn, bàn, khách','Order, table, customer')" /></div></label>
    <label><span>{{ t('orderType') }}</span><select v-model="filters.type"><option value="">{{ t('allTypes') }}</option><option v-for="option in typeOptions" :key="option[0]" :value="option[0]">{{ t(option[1]) }}</option></select></label>
    <label v-if="!settlementsMode"><span>{{ t('status') }}</span><select v-model="filters.status"><option value="">{{ t('allStatuses') }}</option><option v-for="option in statusOptions" :key="option[0]" :value="option[0]">{{ t(option[1]) }}</option></select></label>
    <button type="submit" :disabled="loading">{{ t('query') }}</button>
    <label v-if="!settlementsMode" class="mx-check-filter"><input v-model="filters.abnormal" type="checkbox" />{{ word('仅看异常订单','Chỉ đơn bất thường','Only abnormal orders') }}</label>
  </form>
</template>
