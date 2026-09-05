<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import axios from 'axios';
import { previewOrderVoid, voidOrder, type OrderVoidPreview, type OrderVoidRecord, type VoidReason } from '@/api/order-voids';
import { errorMessage } from '@/api/http';
import { useOrderVoidText } from '@/i18n/order-void';
import OrderVoidEvidence from './OrderVoidEvidence.vue';
import '@/styles/order-void.css';

const props = defineProps<{ target: string }>();
const emit = defineEmits<{ done: [record: OrderVoidRecord] }>();
const copy = useOrderVoidText();
const dialog = ref<HTMLDialogElement>();
const menu = ref<HTMLDetailsElement>();
const preview = ref<OrderVoidPreview | OrderVoidRecord | null>(null);
const reason = ref<VoidReason | ''>('');
const note = ref('');
const busy = ref(false);
const loading = ref(false);
const error = ref('');
const stale = ref(false);
let requestKey = '';
let effectiveTarget = '';
let previewGeneration = 0;
let returnFocus: HTMLElement | null = null;
const alreadyVoided = computed(() => preview.value && 'operationId' in preview.value);
const canSubmit = computed(() => preview.value && !alreadyVoided.value && !busy.value && !loading.value && !stale.value && reason.value && (reason.value !== 'OTHER' || note.value.trim()));

function displayError(caught: unknown) {
  const code = axios.isAxiosError(caught) ? caught.response?.data?.code : '';
  if (code === 'VOID_PREVIEW_STALE') { stale.value = true; return copy.value.stale; }
  if (code === 'VOID_PRINT_IN_FLIGHT') return copy.value.print;
  if (code === 'VOID_OWNER_REQUIRED') return copy.value.owner;
  if (['VOID_ACTIVE_ORDER', 'VOID_OPEN_SESSION'].includes(code)) return copy.value.active;
  if (code === 'VOID_BUSINESS_DAY_CONFLICT') return copy.value.businessDayConflict;
  if (['VOID_SCOPE_CONFLICT', 'VOID_AMOUNT_CONFLICT', 'VOID_AUDIT_MISSING'].includes(code)) return copy.value.conflict;
  return errorMessage(caught);
}
async function refreshPreview() {
  const generation = ++previewGeneration;
  const target = effectiveTarget;
  loading.value = true; error.value = '';
  try {
    let result;
    try { result = await previewOrderVoid(target); }
    catch (caught) {
      // Explicitly show the larger scope before confirmation; POST never expands a child silently.
      if (!axios.isAxiosError(caught) || caught.response?.data?.code !== 'VOID_WHOLE_SESSION_REQUIRED') throw caught;
      if (generation !== previewGeneration) return;
      effectiveTarget = caught.response.data.target;
      result = await previewOrderVoid(effectiveTarget);
    }
    if (generation !== previewGeneration) return;
    preview.value = result;
    stale.value = false;
  } catch (caught) { if (generation === previewGeneration) { preview.value = null; error.value = displayError(caught); } }
  finally { if (generation === previewGeneration) loading.value = false; }
}
async function open() {
  returnFocus = menu.value?.querySelector('summary') ?? null;
  if (menu.value) menu.value.open = false;
  preview.value = null; reason.value = ''; note.value = ''; stale.value = false;
  requestKey = crypto.randomUUID(); effectiveTarget = props.target;
  dialog.value?.showModal();
  await refreshPreview();
}
function close() {
  if (busy.value) return;
  previewGeneration++;
  dialog.value?.close();
  returnFocus?.focus();
}
function trapFocus(event: KeyboardEvent) {
  const root = dialog.value;
  if (!root) return;
  const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]')]
    .filter(element => element.getClientRects().length > 0);
  const first = focusable[0]; const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
async function submit() {
  if (!canSubmit.value || !preview.value || !reason.value) return;
  busy.value = true; error.value = '';
  try {
    const result = await voidOrder(effectiveTarget, { reason: reason.value, note: note.value, requestKey, version: preview.value.version });
    busy.value = false; close(); emit('done', result);
  } catch (caught) { error.value = displayError(caught); }
  finally { busy.value = false; }
}
onBeforeUnmount(() => { previewGeneration++; dialog.value?.close(); });
</script>
<template>
  <details ref="menu" class="order-void-ui void-menu">
    <summary>{{ copy.more }}</summary>
    <div class="void-menu-panel"><button class="void-button void-button--danger" type="button" @click="open">{{ copy.action }}</button></div>
  </details>
  <Teleport to="body">
    <dialog ref="dialog" class="order-void-ui void-dialog" aria-labelledby="void-title" @cancel.prevent="close" @keydown.tab="trapFocus">
      <form @submit.prevent="submit">
        <header><h2 id="void-title">{{ alreadyVoided ? copy.archive : copy.title }}</h2><button class="void-button" type="button" :disabled="busy" autofocus @click="close">{{ copy.back }}</button></header>
        <div class="void-dialog-body" :aria-busy="loading || busy">
          <p v-if="loading" role="status">{{ copy.loading }}</p>
          <template v-else-if="preview">
            <OrderVoidEvidence :value="preview" />
            <p v-if="alreadyVoided" class="void-success" role="status">{{ copy.success }}</p>
            <template v-else>
              <p class="void-warning">{{ preview.settlementImpact.settlementCount ? copy.warning : copy.noImpact }}</p>
              <p>{{ copy.noRefund }}</p>
              <label>{{ copy.reason }}<select v-model="reason" required :disabled="busy"><option disabled value="">{{ copy.choose }}</option><option v-for="key in (['MISTAKE', 'DUPLICATE', 'TEST', 'OTHER'] as const)" :key="key" :value="key">{{ copy[key] }}</option></select></label>
              <label>{{ copy.note }}<textarea v-model="note" rows="2" maxlength="255" :disabled="busy" :required="reason === 'OTHER'" :aria-describedby="reason === 'OTHER' ? 'void-reason-help' : undefined" /></label>
              <small v-if="reason === 'OTHER'" id="void-reason-help">{{ copy.required }}</small>
            </template>
          </template>
          <p class="void-error" role="alert">{{ error }}</p>
          <button v-if="error && !busy" class="void-button" type="button" :disabled="loading" @click="refreshPreview">{{ copy.retry }}</button>
        </div>
        <footer class="void-actions"><button class="void-button" type="button" :disabled="busy" @click="close">{{ copy.back }}</button><button v-if="!alreadyVoided" class="void-button void-button--confirm" :disabled="!canSubmit" type="submit" :aria-busy="busy">{{ busy ? copy.submitting : copy.confirm }}</button></footer>
      </form>
    </dialog>
  </Teleport>
</template>
<style scoped>
/* finesse · component: order-void-dialog · register=product
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * tokens: shared merchant-admin order-void semantic tokens */
.void-menu { position: relative; flex: none; }
.void-menu summary { list-style: none; }
.void-menu-panel { position: absolute; right: 0; top: 100%; z-index: 5; padding: 6px; background: var(--void-surface); box-shadow: var(--void-shadow); border-radius: 10px; }
.void-dialog { padding: 0; width: min(620px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); border: 1px solid var(--void-line); border-radius: 16px; background: var(--void-surface); box-shadow: var(--void-shadow); }
.void-dialog::backdrop { background: var(--void-mask); }
.void-dialog form { display: flex; flex-direction: column; max-height: calc(100dvh - 28px); }
.void-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--void-line); }
.void-dialog h2 { font-size: 20px; margin: 0; min-width: 0; overflow-wrap: anywhere; }
.void-dialog-body { overflow-y: auto; overscroll-behavior: contain; padding: 20px; min-height: 0; line-height: 1.6; }
.void-dialog-body label { margin-top: 14px; }
.void-warning { color: var(--void-danger); font-weight: 600; }
.void-dialog footer { padding: 14px 20px max(14px, env(safe-area-inset-bottom)); border-top: 1px solid var(--void-line); }
@media (max-width: 390px) { .void-dialog header, .void-dialog-body, .void-dialog footer { padding-inline: 14px; } }
</style>
