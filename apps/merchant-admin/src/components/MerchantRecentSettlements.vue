<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { getMerchantSettlements } from '@/api/orders';
import { errorMessage } from '@/api/http';
import type { MerchantSettlement } from '@/types/api';
import { useI18n } from '@/i18n';
const props=defineProps<{from:string;to:string}>();
const emit=defineEmits<{chooseDay:[]}>();
const {locale}=useI18n();const route=useRoute();
const rows=ref<MerchantSettlement[]>([]),loading=ref(false),error=ref('');let sequence=0;
function word(zh:string,vi:string,en:string){return({zh,vi,en})[locale.value];}
async function load(){const request=++sequence;rows.value=[];error.value='';loading.value=false;if(props.from!==props.to)return;loading.value=true;try{const result=await getMerchantSettlements({date:props.from,status:'COMPLETED',page:1,pageSize:5});if(request===sequence)rows.value=result.items;}catch(caught){if(request===sequence)error.value=errorMessage(caught);}finally{if(request===sequence)loading.value=false;}}
watch(()=>[props.from,props.to],load,{immediate:true});
onBeforeUnmount(()=>{++sequence;});
</script>
<template><section class="card m-recent-settlements"><h2>{{ from===to?word('最近结账','Thanh toán gần đây','Recent settlements'):word('按营业日查看结账','Thanh toán theo ngày','Settlements by business date') }}</h2>
  <template v-if="from===to"><p class="m-basis-short">{{ from }} · {{ word('营业日','Ngày kinh doanh','Business date') }}</p><p v-if="loading" role="status">{{ word('加载中…','Đang tải…','Loading…') }}</p><p v-if="error" class="m-error">{{ error }} <button type="button" class="secondary" @click="load">{{ word('重试','Thử lại','Retry') }}</button></p><RouterLink v-for="row in rows" :key="row.settlementId" :to="{path:`/settlements/${encodeURIComponent(row.settlementId)}`,query:{returnTo:route.fullPath}}" class="m-recent-row"><div><strong>{{ row.tableName || row.orderNos[0] }}</strong><small>{{ new Intl.DateTimeFormat(locale,{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(row.settledAt)) }} · {{ row.orderCount }} {{ word('原单','đơn','orders') }}</small></div><b>₫{{ BigInt(row.finalReceivableVnd).toLocaleString() }}</b></RouterLink><p v-if="!loading&&!error&&!rows.length" class="m-basis-short">{{ word('当日暂无已完成结账','Chưa có thanh toán hoàn tất','No completed settlements for this date') }}</p></template>
  <p v-else class="m-basis-short">{{ word('先选择营业日，再查看同一口径的结账记录。','Chọn ngày để xem các bản ghi cùng kỳ.','Choose a business date to see matching records.') }}</p><button type="button" class="secondary" @click="emit('chooseDay')">{{ word('查看结账记录','Xem thanh toán','View records') }} ›</button>
</section></template>
