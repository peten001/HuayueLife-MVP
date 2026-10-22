<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { X } from '@lucide/vue';
import { useI18n } from '@/i18n';
import SoundPreferences from './SoundPreferences.vue';
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const dialog = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
onMounted(async () => { previousFocus = document.activeElement as HTMLElement; await nextTick(); dialog.value?.querySelector<HTMLElement>('button')?.focus(); });
onBeforeUnmount(() => previousFocus?.focus());
function trap(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
  if (event.key !== 'Tab') return;
  const elements = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)') ?? [])];
  const first = elements[0]; const last = elements.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
</script>
<template>
  <div class="sound-settings-overlay" @click.self="emit('close')" @keydown="trap"><section ref="dialog" class="sound-settings-dialog" role="dialog" aria-modal="true" :aria-label="t('sound.settings')"><header><h2>{{ t('sound.settings') }}</h2><button type="button" :aria-label="t('common.close')" @click="emit('close')"><X :size="22" /></button></header><SoundPreferences terminal="cashier" /></section></div>
</template>
<style scoped>
.sound-settings-overlay { position:fixed; inset:0; z-index:200; display:grid; place-items:center; padding:16px; background:var(--cashier-scrim-68); }
.sound-settings-dialog { width:min(480px,100%); max-height:calc(100vh - 32px); max-height:calc(100dvh - 32px); overflow:auto; border:1px solid var(--cashier-border); border-radius:16px; padding:16px; background:var(--cashier-surface); color:var(--cashier-text); }
.sound-settings-dialog > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
.sound-settings-dialog h2 { margin:0; font-size:20px; }
.sound-settings-dialog > header button { width:44px; height:44px; display:grid; place-items:center; padding:0; border:0; border-radius:8px; color:var(--cashier-text); background:var(--cashier-surface-muted); cursor:pointer; }
.sound-settings-dialog button:focus-visible { outline:3px solid var(--cashier-action-primary); outline-offset:3px; }
</style>
