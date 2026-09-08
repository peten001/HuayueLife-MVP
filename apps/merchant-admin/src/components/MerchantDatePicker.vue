<script setup lang="ts">
import { computed, ref } from 'vue';
import MerchantIcon from './MerchantIcon.vue';
import MerchantDialog from './MerchantDialog.vue';
import { useI18n } from '@/i18n';
const props = defineProps<{ from: string; to?: string; anchor: string; single?: boolean; current?: boolean; presets?: 'orders' }>();
const emit = defineEmits<{ change: [value: { from: string; to: string; current: boolean }] }>();
const { locale, t } = useI18n();
const open = ref(false);
const custom = ref(false);
const start = ref('');
const end = ref('');
const invalid = ref(false);
const copy = computed(() => ({ zh: ['营业日','今日','昨日','近7天','本月','上月','自定义','开始日期不能晚于结束日期'], vi: ['Ngày kinh doanh','Hôm nay','Hôm qua','7 ngày qua','Tháng này','Tháng trước','Tùy chỉnh','Ngày bắt đầu phải trước ngày kết thúc'], en: ['Business date','Today','Yesterday','Last 7 days','This month','Last month','Custom','Start date must not follow end date'] })[locale.value]);
const orderCopy = computed(() => ({ zh: ['营业日','今日','昨天','这个周','这个月','上个月'], vi: ['Ngày kinh doanh','Hôm nay','Hôm qua','Tuần này','Tháng này','Tháng trước'], en: ['Business date','Today','Yesterday','This week','This month','Last month'] })[locale.value]);
const dialogTitle = computed(() => ({ zh:'选择营业日',vi:'Chọn ngày kinh doanh',en:'Choose business date' })[locale.value]);
const customHint = computed(() => ({ zh:'选择指定日期',vi:'Chọn ngày cụ thể',en:'Choose a specific date' })[locale.value]);
const applyLabel = computed(() => ({ zh:'应用日期',vi:'Áp dụng ngày',en:'Apply date' })[locale.value]);
const presetIndexes = computed(() => props.presets === 'orders' ? [1,2,3,4,5] : props.single ? [1,2,6] : [1,2,3,4,5,6]);
function weekStart(value: string) { const date = new Date(`${value}T12:00:00Z`); return dateShift(value,-((date.getUTCDay()+6)%7)); }
function presetRange(index: number) {
  let from = props.anchor, to = props.anchor;
  if (index === 2) from = to = dateShift(props.anchor,-1);
  if (index === 3) from = props.presets === 'orders' ? weekStart(to) : dateShift(to,-6);
  if (index === 4) from = `${to.slice(0,7)}-01`;
  if (index === 5) { to = dateShift(`${to.slice(0,7)}-01`,-1); from = `${to.slice(0,7)}-01`; }
  return { from, to };
}
const selectedPreset = computed(() => presetIndexes.value.find(index => { const range = presetRange(index); return range.from === props.from && range.to === (props.to || props.from); }));
const label = computed(() => props.presets === 'orders' && selectedPreset.value ? orderCopy.value[selectedPreset.value] : props.current ? copy.value[1] : props.from === (props.to || props.from) ? props.from : `${props.from} ~ ${props.to}`);
function show() { start.value = props.from; end.value = props.to || props.from; custom.value = false; invalid.value = false; open.value = true; }
function dateShift(value: string, days: number) { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10); }
function optionCaption(index: number) {
  if (index === 6) return customHint.value;
  const range = presetRange(index);
  if (range.from === range.to) return range.from;
  return `${range.from} — ${range.to}`;
}
function choose(index: number) {
  if (index === 6) { custom.value = true; return; }
  const { from, to } = presetRange(index);
  emit('change',{ from, to, current:index === 1 }); open.value = false;
}
function apply() {
  const to = props.single ? start.value : end.value;
  if (!start.value || !to || start.value > to) { invalid.value = true; return; }
  emit('change',{from:start.value,to,current:false}); open.value = false;
}
</script>
<template>
  <button type="button" class="m-date-trigger secondary" aria-haspopup="dialog" :aria-expanded="open" @click="show"><MerchantIcon name="calendar" /><span>{{ label }}</span><span aria-hidden="true">⌄</span></button>
  <MerchantDialog class="m-date-dialog" :open="open" :title="dialogTitle" @close="open = false">
    <div v-if="!custom" class="m-date-options"><button v-for="index in presetIndexes" :key="index" type="button" :class="{ 'is-selected': selectedPreset === index }" :aria-pressed="selectedPreset === index" @click="choose(index)"><span class="m-date-option-copy"><strong>{{ presets === 'orders' ? orderCopy[index] : copy[index] }}</strong><small>{{ optionCaption(index) }}</small></span><span class="m-date-option-check" aria-hidden="true">{{ selectedPreset === index ? '✓' : '' }}</span></button></div>
    <form v-else class="m-date-custom" @submit.prevent="apply">
      <label>{{ single ? copy[0] : ({ zh:'开始日期',vi:'Từ ngày',en:'Start date' })[locale] }}<input v-model="start" type="date" required /></label>
      <label v-if="!single">{{ ({ zh:'结束日期',vi:'Đến ngày',en:'End date' })[locale] }}<input v-model="end" type="date" required :min="start" /></label>
      <p v-if="invalid" role="alert" class="m-error">{{ copy[7] }}</p>
      <button type="submit" class="m-date-apply">{{ applyLabel }}</button>
    </form>
    <button v-if="custom" type="button" class="m-date-back" @click="custom = false"><MerchantIcon name="back" />{{ t('back') }}</button>
  </MerchantDialog>
</template>
<style scoped>
.m-date-trigger { display: flex; max-width: 100%; align-items: center; gap: 9px; font-weight: 600; }
.m-date-trigger svg { width: 18px; height: 18px; flex-shrink: 0; }
.m-date-trigger span:first-of-type { overflow: hidden; text-overflow: ellipsis; }
.m-date-options {
  display: grid;
  overflow: hidden;
  border-radius: 14px;
  background: var(--m-soft-2);
}
.m-date-options button {
  position: relative;
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid var(--m-line-soft);
  border-radius: 0;
  color: var(--m-ink);
  background: transparent;
  text-align: left;
}
.m-date-options button:last-child { border-bottom: 0; }
.m-date-options button.is-selected { color: var(--m-accent); background: var(--m-accent-soft); }
.m-date-option-copy { display: grid; min-width: 0; gap: 1px; }
.m-date-option-copy strong { font-size: 15px; font-weight: 650; letter-spacing: -.012em; }
.m-date-option-copy small { overflow: hidden; color: var(--m-muted); font-size: 11px; font-weight: 450; text-overflow: ellipsis; white-space: nowrap; }
.m-date-options button.is-selected .m-date-option-copy small { color: color-mix(in srgb, var(--m-accent) 74%, var(--m-muted)); }
.m-date-option-check {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: transparent;
  font-size: 13px;
  font-weight: 750;
}
.m-date-options button.is-selected .m-date-option-check { background: var(--m-accent); }
.m-date-custom { display: grid; gap: 14px; }
.m-date-custom label { display: grid; gap: 6px; color: var(--m-muted); font-size: 12px; }
.m-date-custom input { color: var(--m-ink); background: var(--m-surface-solid); }
.m-date-apply { width: 100%; margin-top: 4px; }
.m-date-back {
  display: flex;
  width: fit-content;
  min-height: 40px;
  align-items: center;
  gap: 5px;
  margin: 12px auto 0;
  padding: 6px 10px;
  border: 0;
  color: var(--m-accent);
  background: transparent;
  font-weight: 620;
}
.m-date-back svg { width: 16px; height: 16px; }
:deep(.m-date-dialog) { width: min(430px, calc(100% - 32px)); }
:deep(.m-date-dialog header) { padding: 15px 18px 11px; border-bottom: 0; }
:deep(.m-date-dialog header h2) { font-size: 18px; font-weight: 720; letter-spacing: -.02em; }
:deep(.m-date-dialog header button) {
  width: 36px;
  min-height: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  color: var(--m-muted);
  background: var(--m-soft);
  font-size: 21px;
  font-weight: 400;
}
:deep(.m-date-dialog .m-dialog-body) { padding: 7px 18px 18px; }
@media (hover: hover) and (pointer: fine) {
  .m-date-options button:not(.is-selected):hover { color: var(--m-ink); background: var(--m-soft); }
  .m-date-back:hover { background: var(--m-accent-soft); }
}
@media (max-width: 768px) {
  :deep(.m-date-dialog) { width: 100%; }
  :deep(.m-date-dialog header) { padding: 16px 20px 10px; }
  :deep(.m-date-dialog .m-dialog-body) { padding: 8px 20px calc(18px + env(safe-area-inset-bottom)); }
  .m-date-options button { min-height: 64px; padding-inline: 14px; }
}
</style>
