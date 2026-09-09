<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from '@/i18n';
import { lockMerchantDialog, unlockMerchantDialog } from '@/utils/merchant-dialog-state';
const props = defineProps<{ open: boolean; title: string; variant?: 'drawer'; hideTitle?: boolean; hideHeader?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const { t } = useI18n();
const lockOwner = Symbol('merchant-dialog');
let unmounted = false;
watch(() => props.open, async open => {
  await nextTick();
  if (unmounted || open !== props.open) return;
  if (open && dialog.value && !dialog.value.open) {
    lockMerchantDialog(lockOwner);
    dialog.value.showModal();
  } else if (!open) { dialog.value?.close(); unlockMerchantDialog(lockOwner); }
}, { immediate: true });
onBeforeUnmount(() => { unmounted = true; dialog.value?.close(); unlockMerchantDialog(lockOwner); });
</script>
<template>
  <dialog ref="dialog" class="m-dialog" :class="{ 'm-dialog--drawer': variant === 'drawer', 'm-dialog--title-hidden': hideTitle, 'm-dialog--header-hidden': hideHeader }" :aria-label="title" @cancel.prevent="emit('close')" @click="($event.target === dialog) && emit('close')">
    <header v-if="!hideHeader"><h2 v-if="!hideTitle">{{ title }}</h2><button type="button" class="secondary" :aria-label="t('close')" @click="emit('close')">×</button></header>
    <div class="m-dialog-body"><slot /></div>
    <footer v-if="$slots.footer" class="m-dialog-footer"><slot name="footer" /></footer>
  </dialog>
</template>
<style scoped>
.m-dialog{padding:0;width:min(560px,calc(100% - 40px));max-height:calc(100dvh - 64px);border:0;border-radius:16px;color:var(--m-ink);background:var(--m-surface);box-shadow:0 20px 60px rgb(24 52 38 / 20%)}
.m-dialog[open]{display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden}
.m-dialog::backdrop{background:rgb(18 31 24 / 40%)}
.m-dialog header{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 22px;background:var(--m-surface);border-bottom:1px solid var(--m-line)}
.m-dialog--drawer{width:min(860px,calc(100% - 64px));height:100dvh;max-height:100dvh;margin:0 0 0 auto;border-radius:18px 0 0 18px}.m-dialog--drawer .m-dialog-body{padding:24px}
.m-dialog h2{margin:0}.m-dialog header button{width:44px;height:44px;font-size:24px;padding:0}.m-dialog-body{padding:20px 22px}
.m-dialog-body{min-height:0;overflow-y:auto;overscroll-behavior:contain}
.m-dialog-footer{z-index:1;padding:14px 22px;border-top:1px solid var(--m-line);background:var(--m-surface)}
.m-dialog-footer :slotted(.mx-editor-actions){margin:0}
.m-dialog--title-hidden header{justify-content:flex-end;padding-block:10px}
.m-dialog--header-hidden.m-dialog--drawer .m-dialog-body{padding-top:24px}
@media(max-width:768px){.m-dialog{width:100%;max-width:none;max-height:calc(100dvh - env(safe-area-inset-top) - 20px);margin:auto 0 0;border-radius:18px 18px 0 0}.m-dialog-body{padding:12px 18px calc(22px + env(safe-area-inset-bottom))}.m-dialog header{padding:14px 18px}.m-dialog-footer{padding:12px 16px calc(12px + env(safe-area-inset-bottom))}}
@media(max-width:768px){.m-dialog--drawer{height:100dvh;max-height:100dvh;border-radius:0;margin:0;width:100%}.m-dialog--drawer header{padding-top:calc(14px + env(safe-area-inset-top))}.m-dialog--drawer.m-dialog--title-hidden header{padding-top:calc(8px + env(safe-area-inset-top));padding-bottom:8px}.m-dialog--drawer .m-dialog-body{padding:18px 16px calc(22px + env(safe-area-inset-bottom))}.m-dialog--header-hidden.m-dialog--drawer .m-dialog-body{padding-top:calc(12px + env(safe-area-inset-top))}}
</style>
