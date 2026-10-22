<script setup lang="ts">
import { computed, ref } from 'vue';
import { Volume2 } from '@lucide/vue';
import { useSoundStore } from '@/stores/sound';
import { useI18n } from '@/i18n';
import type { NewOrderAlert, SoundMode, SoundTerminal } from './new-order-alerts';

const props = defineProps<{ terminal: SoundTerminal }>();
const sound = useSoundStore(props.terminal);
const { t } = useI18n();
const previewType = ref<NewOrderAlert['orderType']>('DINE_IN');
const previewing = ref(false);
const status = computed(() => sound.working ? 'working' : !sound.enabled ? 'off' : sound.volume === 0 ? 'muted' : sound.active ? 'ready' : 'reactivate');
async function toggle() {
  if (sound.enabled) sound.disable();
  else await sound.enable();
}
async function changeMode(event: Event) {
  const wasEnabled = sound.enabled;
  sound.setMode((event.target as HTMLSelectElement).value as SoundMode);
  if (wasEnabled) await sound.enable();
}
async function preview() {
  previewing.value = true;
  try { await sound.preview(previewType.value); }
  finally { previewing.value = false; }
}
</script>

<template>
  <section class="sound-preferences" :data-terminal="terminal" :aria-label="t('sound.settings')">
    <header class="sound-preferences__heading">
      <div><strong><Volume2 :size="19" aria-hidden="true" />{{ t('sound.settings') }}</strong><small>{{ t(terminal === 'cashier' ? 'sound.cashierHint' : 'sound.kdsHint') }}</small></div>
      <button type="button" class="sound-preferences__switch" role="switch" :aria-label="t('sound.settings')" :aria-checked="sound.enabled" :aria-busy="sound.working" :disabled="sound.working" @click="toggle"><span /></button>
    </header>
    <p class="sound-preferences__status" :class="{ 'is-ready': sound.active }" role="status">{{ t(`sound.${status}`) }}</p>
    <button v-if="sound.enabled && !sound.unlocked" type="button" class="sound-preferences__button" :disabled="sound.working || !sound.supported" @click="sound.enable">{{ t('sound.activate') }}</button>
    <label class="sound-preferences__field"><span>{{ t('sound.mode') }}</span><select :value="sound.mode" :disabled="sound.working" @change="changeMode"><option value="tone">{{ t('sound.tone') }}</option><option value="speech">{{ t('sound.speech') }}</option><option value="both">{{ t('sound.both') }}</option></select></label>
    <label class="sound-preferences__field"><span>{{ t('sound.volume') }} <b>{{ sound.volume }}%</b></span><input type="range" min="0" max="100" step="5" :value="sound.volume" :aria-label="t('sound.volume')" :disabled="sound.working" @input="sound.setVolume(Number(($event.target as HTMLInputElement).value))" /></label>
    <div class="sound-preferences__preview">
      <label class="sound-preferences__field"><span>{{ t('sound.previewType') }}</span><select v-model="previewType" :disabled="previewing"><option value="DINE_IN">{{ t('sound.dine') }} · 02</option><option value="DELIVERY">{{ t('sound.delivery') }}</option><option value="PICKUP">{{ t('sound.pickup') }}</option></select></label>
      <button type="button" class="sound-preferences__button" :aria-busy="previewing" :disabled="previewing || sound.working || !sound.supported || sound.volume === 0" @click="preview">{{ t(previewing ? 'sound.playing' : 'sound.preview') }}</button>
    </div>
    <p class="sound-preferences__error" role="alert">{{ sound.lastError ? t(sound.lastError) : '' }}</p>
    <small class="sound-preferences__hint">{{ t(terminal === 'cashier' ? 'sound.cashierDeviceHint' : 'sound.kdsDeviceHint') }} {{ t('sound.voiceHint') }}</small>
  </section>
</template>

<style scoped>
/* finesse · component: new order sound preferences · register=product
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * tokens: inherited (cashier tokens.css) */
.sound-preferences { display:grid; gap:12px; min-width:0; padding:16px; border:1px solid var(--cashier-border); border-radius:12px; color:var(--cashier-text); background:var(--cashier-surface); font-family:var(--sound-font, inherit); font-size:14px; text-align:start; }
.sound-preferences__heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0; border:0; }
.sound-preferences__heading > div { display:grid; min-width:0; gap:6px; }
.sound-preferences__heading strong { display:flex; align-items:center; gap:6px; font-size:16px; line-height:1.5; }
.sound-preferences small { color:var(--cashier-text-secondary); font-size:12px; line-height:1.6; }
.sound-preferences__switch { display:grid; flex:none; align-items:center; width:56px; height:44px; padding:9px 3px; border:1px solid var(--cashier-border-strong); border-radius:24px; background:var(--cashier-surface-muted); cursor:pointer; }
.sound-preferences__switch span { display:block; width:24px; height:24px; border-radius:50%; background:var(--cashier-text-muted); }
.sound-preferences__switch[aria-checked=true] { background:var(--cashier-action-primary); border-color:var(--cashier-action-primary); }
.sound-preferences__switch[aria-checked=true] span { margin-inline-start:24px; background:var(--cashier-white); }
.sound-preferences__status { margin:0; color:var(--cashier-text-secondary); font-size:13px; line-height:1.5; }
.sound-preferences__status.is-ready { color:var(--cashier-action-primary); }
.sound-preferences__field { display:grid; min-width:0; gap:6px; margin:0; color:var(--cashier-text); font-size:13px; }
.sound-preferences__field > span { display:flex; justify-content:space-between; gap:8px; }
.sound-preferences select { width:100%; min-width:0; min-height:44px; padding:8px 10px; border:1px solid var(--cashier-border-strong); border-radius:8px; color:var(--cashier-text); background:var(--cashier-surface-soft); font:inherit; }
.sound-preferences input[type=range] { width:100%; min-width:0; min-height:44px; margin:0; accent-color:var(--cashier-action-primary); cursor:pointer; }
.sound-preferences__preview { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:10px; }
.sound-preferences__button { min-height:44px; padding:8px 14px; border:1px solid var(--cashier-action-primary); border-radius:8px; color:var(--cashier-white); background:var(--cashier-action-primary); font:inherit; font-weight:700; cursor:pointer; }
.sound-preferences__error { min-height:1lh; margin:0; color:var(--cashier-action-danger); font-size:12px; line-height:1.5; }
.sound-preferences__hint { display:block; }
.sound-preferences :is(button,select,input):focus-visible,.sound-preferences .is-focus { outline:3px solid var(--cashier-action-primary); outline-offset:3px; }
.sound-preferences :is(button,select,input):disabled { opacity:.5; cursor:not-allowed; }
.sound-preferences__button:active,.sound-preferences__button.is-active { background:var(--cashier-action-primary-hover); }
.sound-preferences [aria-busy=true] { opacity:.65; cursor:progress; }
@media (hover:hover) { .sound-preferences__button:not(:disabled):hover,.sound-preferences__button.is-hover { background:var(--cashier-action-primary-hover); } }
</style>
