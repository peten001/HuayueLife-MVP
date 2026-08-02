<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  createPrintingRule,
  getPrintingRouting,
  getPrintingPrinters,
  getPrintingRules,
  getPrintingTemplates,
  setPrintingRuleEnabled,
  updatePrintingRouting,
  updatePrintingRule,
} from '@/api/printing';
import { getCategories } from '@/api/merchant';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  PrintingOrderType,
  PrintingPrinter,
  PrintingReceiptType,
  PrintingReceiptTemplate,
  PrintingRule,
  PrintingRulePayload,
  PrintingRouting,
  PrintingTriggerEvent,
} from '@/types/printing';
import type { Category } from '@/types/api';
import { PRINTING_STATE_CHANGED_EVENT } from '@/utils/printing-status';
import {
  lanPrinterIsOnline,
  normalizedLanSummary,
} from '@/utils/lan-printer-admin-state';

const { p } = usePrintingI18n();
const rows = ref<PrintingRule[]>([]);
const printers = ref<PrintingPrinter[]>([]);
const templates = ref<PrintingReceiptTemplate[]>([]);
const categories = ref<Category[]>([]);
const routing = ref<PrintingRouting>({
  configured: false,
  checkoutDefaultPrinterId: null,
  defaultKitchenPrinterId: null,
  printers: [],
});
const loading = ref(false);
const saving = ref(false);
const modalOpen = ref(false);
const message = ref('');
const success = ref(false);
const ruleNameInput = ref<HTMLInputElement | null>(null);
let ruleDialogReturnFocus: HTMLElement | null = null;

const form = reactive({
  id: '',
  name: '',
  orderType: '' as PrintingOrderType | '',
  triggerEvent: 'ORDER_ACCEPTED' as PrintingTriggerEvent,
  receiptType: 'ORDER_CUSTOMER' as PrintingReceiptType,
  printerId: '',
  receiptTemplateId: '',
  copies: 1,
  autoPrint: false,
  priority: 100,
});

const printerNames = computed(() => new Map(printers.value.map((printer) => [printer.id, printer.name])));
const rulePrinters = computed(() =>
  printers.value.filter(
    (printer) => printer.enabled && (
      printer.channelType !== 'LOCAL_LAN_ESCPOS'
      || Boolean(
        normalizedLanSummary(printer)?.terminalId
        && normalizedLanSummary(printer)?.localBindingId,
      )
    ),
  ),
);
const frontDeskPrinters = computed(() => printers.value.filter((printer) => printer.purpose === 'FRONT_DESK'));
const kitchenPrinters = computed(() => printers.value.filter((printer) => printer.purpose === 'KITCHEN'));
const hasAnyPrinters = computed(() => printers.value.length > 0);
const allPrintersDisabled = computed(() =>
  hasAnyPrinters.value && rulePrinters.value.length === 0,
);
const matchingTemplates = computed(() => {
  const printer = printers.value.find((item) => item.id === form.printerId);
  return templates.value.filter(
    (template) =>
      template.enabled &&
      template.receiptType === form.receiptType &&
      (!printer || template.paperWidth === printer.paperWidth),
  );
});
// Automatic creation has durable order events plus the independent table
// settlement event. MANUAL remains readable for historical rows only.
const triggerEvents: PrintingTriggerEvent[] = ['ORDER_ACCEPTED', 'ORDER_COMPLETED', 'TABLE_SESSION_SETTLED'];
const orderTypes: PrintingOrderType[] = ['DINE_IN', 'PICKUP', 'DELIVERY'];
const scenarios = [
  { key: 'DINE_IN', title: 'dineInScenario', hint: 'dineInScenarioHint', receiptType: 'ORDER_CUSTOMER' as PrintingReceiptType },
  { key: 'PICKUP', title: 'pickupScenario', hint: 'pickupScenarioHint', receiptType: 'ORDER_CUSTOMER' as PrintingReceiptType },
  { key: 'DELIVERY', title: 'deliveryScenario', hint: 'deliveryScenarioHint', receiptType: 'ORDER_CUSTOMER' as PrintingReceiptType },
  { key: 'TABLE_BILL', title: 'checkoutScenario', hint: 'checkoutScenarioHintFinal', receiptType: 'TABLE_BILL' as PrintingReceiptType },
] as const;

const scenarioRules = computed(() => scenarios.map((scenario) => ({
  ...scenario,
  rule: scenario.key === 'TABLE_BILL'
    ? rows.value.find((row) => row.receiptType === scenario.receiptType)
    : rows.value.find((row) => row.orderType === scenario.key),
})));

function triggerEventLabel(event: PrintingTriggerEvent) {
  if (event === 'TABLE_SESSION_SETTLED') return p('tableSessionSettled');
  return event === 'ORDER_COMPLETED' ? p('orderCompleted') : p('orderAccepted');
}

function orderTypeLabel(type: PrintingOrderType | null | '' | undefined) {
  if (!type) return p('allOrderTypes');
  return type === 'DINE_IN' ? p('dineInOrder') : type === 'PICKUP' ? p('pickupOrder') : p('deliveryOrder');
}

function receiptTypeLabel(type: PrintingReceiptType) {
  return type === 'TABLE_BILL' ? p('checkoutReceipt') : p('customerReceipt');
}

function printerOptionLabel(printer: PrintingPrinter) {
  if (printer.channelType !== 'LOCAL_LAN_ESCPOS') return printer.name;
  const terminalName = normalizedLanSummary(printer)?.terminal?.name || p('notReported');
  const onlineLabel = lanPrinterIsOnline(printer) ? p('online') : p('offline');
  return `${printer.name} · ${p('lanPrinting')} · ${terminalName} · ${onlineLabel}`;
}

function resetForm() {
  Object.assign(form, {
    id: '',
    name: '',
    orderType: '',
    triggerEvent: 'ORDER_ACCEPTED',
    receiptType: 'ORDER_CUSTOMER',
    printerId: rulePrinters.value[0]?.id ?? '',
    receiptTemplateId: '',
    copies: 1,
    autoPrint: false,
    priority: 100,
  });
}

function rememberRuleDialogFocus() {
  ruleDialogReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
}

function openCreate() {
  rememberRuleDialogFocus();
  resetForm();
  modalOpen.value = true;
  void nextTick(() => ruleNameInput.value?.focus());
}

function openEdit(row: PrintingRule) {
  rememberRuleDialogFocus();
  Object.assign(form, {
    id: row.id,
    name: row.name,
    orderType: row.orderType ?? '',
    triggerEvent: row.triggerEvent,
    receiptType: row.receiptType,
    printerId: row.printerId,
    receiptTemplateId: row.receiptTemplateId ?? '',
    copies: row.copies,
    autoPrint: row.autoPrint,
    priority: row.priority,
  });
  modalOpen.value = true;
  void nextTick(() => ruleNameInput.value?.focus());
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
  const target = ruleDialogReturnFocus;
  ruleDialogReturnFocus = null;
  void nextTick(() => {
    if (target?.isConnected) target.focus();
  });
}

function payload(): PrintingRulePayload {
  return {
    name: form.name.trim(),
    orderType: form.orderType || null,
    triggerEvent: form.triggerEvent,
    receiptType: form.receiptType,
    printerId: form.printerId,
    receiptTemplateId: form.receiptTemplateId || (form.id ? null : undefined),
    copies: Number(form.copies),
    autoPrint: form.autoPrint,
    ...(form.id ? {} : { enabled: false }),
    priority: Number(form.priority),
  };
}

async function load() {
  try {
    loading.value = true;
    [rows.value, printers.value, templates.value, categories.value, routing.value] = await Promise.all([
      getPrintingRules(),
      getPrintingPrinters(),
      getPrintingTemplates(),
      getCategories(),
      getPrintingRouting(),
    ]);
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

function routingEntry(printerId: string) {
  return routing.value.printers.find((entry) => entry.printerId === printerId);
}

function autoPrintEnabled(printerId: string) {
  return routingEntry(printerId)?.newOrderAutoPrint ?? false;
}

function categoryIdsFor(printerId: string) {
  return routingEntry(printerId)?.categoryIds ?? [];
}

function toggleRoutingPrinter(printer: PrintingPrinter, event: Event) {
  const entry = routingEntry(printer.id);
  const newOrderAutoPrint = (event.target as HTMLInputElement).checked;
  if (entry) entry.newOrderAutoPrint = newOrderAutoPrint;
  else routing.value.printers.push({ printerId: printer.id, newOrderAutoPrint, categoryIds: [] });
  void saveRouting();
}

function toggleCategory(printer: PrintingPrinter, categoryId: string, event: Event) {
  let entry = routingEntry(printer.id);
  if (!entry) {
    entry = { printerId: printer.id, newOrderAutoPrint: false, categoryIds: [] };
    routing.value.printers.push(entry);
  }
  const next = new Set(entry.categoryIds);
  if ((event.target as HTMLInputElement).checked) next.add(categoryId);
  else next.delete(categoryId);
  entry.categoryIds = [...next];
  void saveRouting();
}

async function saveRouting() {
  try {
    saving.value = true;
    const activePrinters = [...frontDeskPrinters.value, ...kitchenPrinters.value]
      .filter((printer) => printer.enabled)
      .map((printer) => ({
        printerId: printer.id,
        newOrderAutoPrint: autoPrintEnabled(printer.id),
        categoryIds: printer.purpose === 'KITCHEN' ? categoryIdsFor(printer.id) : [],
      }));
    routing.value = await updatePrintingRouting({
      checkoutDefaultPrinterId: routing.value.checkoutDefaultPrinterId,
      defaultKitchenPrinterId: routing.value.defaultKitchenPrinterId,
      printers: activePrinters,
    });
    await load();
    notifyPrintingStateChanged();
    showSuccess('自动打印配置已保存');
  } catch (error) {
    await load();
    showError(error);
  } finally {
    saving.value = false;
  }
}

async function save() {
  if (form.autoPrint && !window.confirm(p('enableAutoPrintConfirm'))) return;
  try {
    saving.value = true;
    if (form.id) {
      await updatePrintingRule(form.id, payload());
    } else {
      await createPrintingRule(payload());
    }
    closeModal();
    await load();
    notifyPrintingStateChanged();
    showSuccess(p('ruleSaved'));
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

async function toggle(row: PrintingRule) {
  if (!row.enabled && !window.confirm(p('enableRuleConfirm'))) return;
  try {
    await setPrintingRuleEnabled(row.id, !row.enabled);
    await load();
    notifyPrintingStateChanged();
    showSuccess(row.enabled ? p('disabled') : p('ruleEnabledHint'));
  } catch (error) {
    showError(error);
  }
}

async function toggleScenario(rule: PrintingRule | undefined) {
  if (rule) await toggle(rule);
}

type ScenarioRule = (typeof scenarios)[number] & { rule?: PrintingRule };

async function changeScenarioPrinter(scenario: ScenarioRule, event: Event) {
  const printerId = (event.target as HTMLSelectElement).value;
  if (!printerId) return;
  try {
    saving.value = true;
    if (scenario.rule) {
      await updatePrintingRule(scenario.rule.id, { printerId });
    } else {
      await createPrintingRule({
        name: p(scenario.title),
        orderType: scenario.key === 'TABLE_BILL' ? null : scenario.key as PrintingOrderType,
        triggerEvent: scenario.key === 'TABLE_BILL' ? 'TABLE_SESSION_SETTLED' : 'ORDER_ACCEPTED',
        receiptType: scenario.receiptType,
        printerId,
        copies: 1,
        autoPrint: false,
        enabled: false,
        priority: 100,
      });
    }
    await load();
    notifyPrintingStateChanged();
    showSuccess(p('ruleSaved'));
  } catch (error) { showError(error); } finally { saving.value = false; }
}

function showError(error: unknown) {
  success.value = false;
  message.value = errorMessage(error);
}

function showSuccess(value: string) {
  success.value = true;
  message.value = value;
}

function notifyPrintingStateChanged() {
  window.dispatchEvent(new Event(PRINTING_STATE_CHANGED_EVENT));
}

function refreshRules() { void load(); }

onMounted(() => {
  void load();
  window.addEventListener(PRINTING_STATE_CHANGED_EVENT, refreshRules);
});
onBeforeUnmount(() => window.removeEventListener(PRINTING_STATE_CHANGED_EVENT, refreshRules));
</script>

<template>
  <section class="printing-panel">
    <div class="printing-toolbar">
      <div class="printing-toolbar__copy">
        <h2>{{ p('rules') }}</h2>
        <p>{{ p('automaticPrintDescription') }}</p>
      </div>
      <div class="printing-toolbar__actions">
        <button class="printing-button printing-button--secondary" type="button" @click="load">{{ p('refresh') }}</button>
        <span class="printing-hint">{{ p('automaticPrintSetupHint') }}</span>
      </div>
    </div>

    <p :class="['printing-message', { 'printing-message--success': success }]">{{ message }}</p>

    <section class="printing-routing" aria-label="自动打印配置">
      <div class="printing-routing__notice"><strong>自动打印配置</strong><span>前台打印完整订单；厨房按菜品分类拆分，同一台打印机的菜品合并为一张小票。</span></div>
      <section class="printing-routing__section">
        <header><div><span class="printing-routing__eyebrow">FRONT DESK</span><h3>前台打印机</h3><p>开启后，堂食、自取和配送新订单都会打印完整订单。</p></div><label class="printing-routing__select">结账默认打印机<select v-model="routing.checkoutDefaultPrinterId" :disabled="saving" @change="saveRouting"><option :value="null">未设置</option><option v-for="printer in frontDeskPrinters.filter((item) => item.enabled)" :key="printer.id" :value="printer.id">{{ printer.name }}</option></select></label></header>
        <div v-if="frontDeskPrinters.length" class="printing-routing__cards"><article v-for="printer in frontDeskPrinters" :key="printer.id" class="printing-routing__card"><div class="printing-routing__card-head"><div><strong>{{ printer.name }}</strong><small>{{ printer.paperWidth === 'MM58' ? '58 mm' : '80 mm' }} · {{ printer.status }}</small></div><span :class="['printing-routing__status', printer.enabled ? 'is-enabled' : 'is-disabled']">{{ printer.enabled ? '已启用' : '已停用' }}</span></div><label class="printing-routing__row"><span>新订单自动打印</span><input type="checkbox" :checked="autoPrintEnabled(printer.id)" :disabled="saving || !printer.enabled" @change="toggleRoutingPrinter(printer, $event)" /></label><p>前台打印完整订单，不按菜品分类拆分。</p></article></div><div v-else class="printing-routing__empty">暂无前台打印机，请先在打印机列表添加。</div>
      </section>
      <section class="printing-routing__section">
        <header><div><span class="printing-routing__eyebrow">KITCHEN</span><h3>厨房打印机</h3><p>分类未匹配的菜品将发送到默认厨房打印机。</p></div><label class="printing-routing__select">默认厨房打印机<select v-model="routing.defaultKitchenPrinterId" :disabled="saving" @change="saveRouting"><option :value="null">未设置</option><option v-for="printer in kitchenPrinters.filter((item) => item.enabled)" :key="printer.id" :value="printer.id">{{ printer.name }}</option></select></label></header>
        <div v-if="kitchenPrinters.length" class="printing-routing__cards"><article v-for="printer in kitchenPrinters" :key="printer.id" class="printing-routing__card"><div class="printing-routing__card-head"><div><strong>{{ printer.name }}</strong><small>{{ printer.paperWidth === 'MM58' ? '58 mm' : '80 mm' }} · {{ printer.status }}</small></div><span :class="['printing-routing__status', printer.enabled ? 'is-enabled' : 'is-disabled']">{{ printer.enabled ? '已启用' : '已停用' }}</span></div><label class="printing-routing__row"><span>新订单自动打印</span><input type="checkbox" :checked="autoPrintEnabled(printer.id)" :disabled="saving || !printer.enabled" @change="toggleRoutingPrinter(printer, $event)" /></label><div class="printing-routing__binding"><span>菜品分类</span><label v-for="category in categories.filter((item) => item.isActive)" :key="category.id"><input type="checkbox" :checked="categoryIdsFor(printer.id).includes(category.id)" :disabled="saving || !printer.enabled" @change="toggleCategory(printer, category.id, $event)" /> {{ category.nameZh }}</label><em v-if="!categories.length">暂无可用菜品分类</em></div></article></div><div v-else class="printing-routing__empty">暂无厨房打印机，请先在打印机列表添加。</div>
      </section>
    </section>

    <section v-if="!hasAnyPrinters" class="printing-auto-empty-state">
      <strong>{{ p('noPrinters') }}</strong><p>{{ p('pleaseAddPrinter') }}</p><RouterLink class="printing-button" to="/printing-center/printers">{{ p('addPrinter') }}</RouterLink>
    </section>
    <section v-else-if="allPrintersDisabled" class="printing-auto-empty-state printing-auto-empty-state--disabled">
      <strong>{{ p('printersNotEnabled') }}</strong><p>{{ p('enablePrinterFromDetailsHint') }}</p><RouterLink class="printing-button" to="/printing-center/printers">{{ p('viewPrinters') }}</RouterLink>
    </section>
    <section v-else class="printing-scenario-grid" aria-label="自动打印场景">
      <article v-for="scenario in scenarioRules" :key="scenario.key" class="printing-scenario-card">
        <div class="printing-scenario-card__heading"><span class="printing-scenario-card__icon" aria-hidden="true">{{ scenario.key === 'DINE_IN' ? '🍴' : scenario.key === 'PICKUP' ? '▣' : scenario.key === 'DELIVERY' ? '➜' : '▤' }}</span><div><h3>{{ p(scenario.title) }}</h3><p>{{ p(scenario.hint) }}</p></div></div>
        <div class="printing-scenario-card__controls">
          <span :class="['printing-badge', scenario.rule?.enabled ? 'printing-badge--success' : 'printing-badge--warning']">{{ scenario.rule ? (scenario.rule.enabled ? p('enabled') : p('disabled')) : p('notConfigured') }}</span>
          <select :value="scenario.rule?.printerId || ''" :disabled="saving" :aria-label="p('targetPrinter')" @change="changeScenarioPrinter(scenario, $event)"><option value="">{{ scenario.rule?.printer?.name || p('choosePrinter') }}</option><option v-for="printer in rulePrinters" :key="printer.id" :value="printer.id">{{ printerOptionLabel(printer) }}</option></select>
          <button class="printing-toggle" type="button" :disabled="!scenario.rule" :aria-pressed="Boolean(scenario.rule?.enabled)" @click="toggleScenario(scenario.rule)"><span>{{ scenario.rule?.enabled ? p('enabled') : p('enable') }}</span></button>
        </div>
      </article>
    </section>

    <p v-if="!rulePrinters.length" class="printing-inline-note"><strong>{{ p('pleaseAddPrinter') }}</strong><span>{{ p('addPrinterBeforeAutoPrint') }}</span></p>

    <section class="printing-category-rules">
      <header class="printing-category-rules__header"><div><h2>分类打印规则</h2><p>按菜品分类、订单场景或小票类型分配打印机</p></div><button class="printing-button printing-button--secondary" type="button" @click="openCreate">⚙ 管理分类</button></header>
      <div class="printing-table-wrap">
      <table class="printing-table">
        <thead>
          <tr>
            <th>分类 / 场景</th><th>说明</th><th>分配的打印机</th><th>优先级</th>
            <th>{{ p('status') }}</th>
            <th>{{ p('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td><div class="printing-rule-name"><span class="printing-rule-icon" aria-hidden="true">▤</span><div><strong>{{ row.name }}</strong><span class="printing-rule-tags"><em>{{ receiptTypeLabel(row.receiptType) }}</em><em>{{ orderTypeLabel(row.orderType) }}</em></span></div></div></td>
            <td>{{ triggerEventLabel(row.triggerEvent) }} · {{ row.copies }} 份</td>
            <td><div class="printing-assigned-printer"><span aria-hidden="true">▣</span><div>{{ row.printer?.name || printerNames.get(row.printerId) || row.printerId }}<small>USB001</small></div></div></td>
            <td>{{ row.priority }}</td>
            <td><span :class="['printing-status-dot', row.enabled ? 'is-enabled' : 'is-disabled']">{{ row.enabled ? p('enabled') : p('disabled') }}</span></td>
            <td>
              <div class="printing-actions">
                <button class="printing-icon-action" type="button" aria-label="编辑规则" @click="openEdit(row)">✎</button>
                <button class="printing-icon-action printing-icon-action--danger" type="button" :aria-label="row.enabled ? '停用规则' : '启用规则'" @click="toggle(row)">{{ row.enabled ? '♧' : '＋' }}</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td class="printing-empty" colspan="6">{{ p('noData') }}</td></tr>
          <tr v-if="loading"><td class="printing-empty" colspan="6">{{ p('loading') }}</td></tr>
        </tbody>
      </table>
      </div>
    </section>
  </section>

  <div v-if="modalOpen" class="printing-modal-backdrop" @click.self="closeModal" @keydown.esc="closeModal">
    <form class="printing-modal" role="dialog" aria-modal="true" aria-labelledby="printing-rule-form-title" @submit.prevent="save">
      <header class="printing-modal__header"><h2 id="printing-rule-form-title">{{ form.id ? p('editRule') : p('addRule') }}</h2></header>
      <div class="printing-modal__body">
        <label class="printing-field">
          {{ p('name') }}
          <input ref="ruleNameInput" v-model="form.name" required maxlength="80" />
        </label>
        <label class="printing-field">
          {{ p('targetPrinter') }}
          <select v-model="form.printerId" required>
            <option v-if="form.printerId && !rulePrinters.some((printer) => printer.id === form.printerId)" :value="form.printerId" disabled>{{ printerNames.get(form.printerId) || form.printerId }} · {{ p('currentlyUnavailable') }}</option>
            <option v-for="printer in rulePrinters" :key="printer.id" :value="printer.id">{{ printerOptionLabel(printer) }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('triggerEvent') }}
          <select v-model="form.triggerEvent">
            <option v-for="event in triggerEvents" :key="event" :value="event">{{ triggerEventLabel(event) }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('targetTemplate') }}
          <select v-model="form.receiptTemplateId">
            <option value="">—</option>
            <option v-for="template in matchingTemplates" :key="template.id" :value="template.id">{{ template.name }} · v{{ template.version }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('receiptType') }}
          <select v-model="form.receiptType">
            <option value="ORDER_CUSTOMER">{{ p('customerReceipt') }}</option>
            <option value="TABLE_BILL">{{ p('checkoutReceipt') }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('orderType') }}
          <select v-model="form.orderType">
            <option value="">{{ p('allOrderTypes') }}</option>
            <option v-for="type in orderTypes" :key="type" :value="type">{{ orderTypeLabel(type) }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('copies') }}
          <input v-model.number="form.copies" required type="number" min="1" max="3" />
        </label>
        <label class="printing-field">
          {{ p('priority') }}
          <input v-model.number="form.priority" required type="number" min="0" max="1000" />
        </label>
        <label class="printing-check">
          <input v-model="form.autoPrint" type="checkbox" />
          {{ p('autoPrint') }}
        </label>
        <p class="printing-hint printing-field--full">{{ p('ruleDefaultOffHint') }}</p>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeModal">{{ p('cancel') }}</button>
        <button class="printing-button" type="submit" :disabled="saving">{{ saving ? p('saving') : p('save') }}</button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.printing-auto-empty-state,.printing-scenario-grid,.printing-inline-note,.printing-category-rules{display:none!important}
.printing-routing{display:grid;gap:16px}
.printing-routing__notice{display:flex;gap:10px;align-items:center;padding:12px 14px;border:1px solid #cfe7d6;border-radius:10px;color:#17693c;background:#eef9f1;font-size:13px}
.printing-routing__notice span{color:#4d6657}
.printing-routing__section{display:grid;gap:14px;padding:18px;border:1px solid var(--printing-border);border-radius:12px;background:#fff}
.printing-routing__section>header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
.printing-routing__eyebrow{color:#2b8750;font-size:11px;font-weight:800;letter-spacing:.08em}
.printing-routing h3{margin:3px 0 0;color:var(--printing-ink);font-size:20px}.printing-routing p{margin:4px 0 0;color:var(--printing-muted);font-size:13px}
.printing-routing__select{display:grid;gap:5px;min-width:220px;color:var(--printing-muted);font-size:12px;font-weight:700}.printing-routing__select select{height:38px;padding:0 10px;border:1px solid var(--printing-border);border-radius:8px;background:#f7faf8;color:#66736b}
.printing-routing__cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.printing-routing__card{display:grid;gap:12px;padding:14px;border:1px solid #e2ebe4;border-radius:10px;background:#fbfdfb}.printing-routing__card-head,.printing-routing__row{display:flex;align-items:center;justify-content:space-between;gap:12px}.printing-routing__card-head strong{display:block;color:var(--printing-ink);font-size:15px}.printing-routing__card-head small{display:block;margin-top:3px;color:var(--printing-muted);font-size:12px}.printing-routing__status{font-size:12px;font-weight:700}.printing-routing__status.is-enabled{color:#168448}.printing-routing__status.is-disabled{color:#7b8790}.printing-routing__row{font-size:13px;color:var(--printing-ink)}.printing-routing__binding{display:flex;flex-wrap:wrap;gap:8px;padding:9px 10px;border:1px dashed #d3dfd6;border-radius:8px}.printing-routing__binding>span{width:100%;color:var(--printing-muted);font-size:12px}.printing-routing__binding label{font-size:12px;color:var(--printing-ink)}.printing-routing__binding em{color:#89948d;font-size:12px;font-style:normal}.printing-routing__empty{padding:18px;border:1px dashed #d7e2d9;border-radius:9px;color:var(--printing-muted);background:#fbfdfb;font-size:13px}
@media(max-width:900px){.printing-routing__section>header{display:grid}.printing-routing__select{min-width:0}.printing-routing__cards{grid-template-columns:1fr}}
.printing-scenario-card__heading{display:flex;align-items:flex-start;gap:12px}
.printing-scenario-card__icon{display:grid;place-items:center;width:42px;height:42px;flex:0 0 42px;border-radius:50%;color:#168448;background:#e8f5eb;font-size:22px}
.printing-category-rules{padding:16px;border:1px solid var(--printing-border);border-radius:12px;background:#fff}
.printing-category-rules__header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}
.printing-category-rules__header h2{margin:0;font-size:18px}.printing-category-rules__header p{margin:4px 0 0;color:var(--printing-muted);font-size:13px}
.printing-rule-name{display:flex;align-items:center;gap:10px}.printing-rule-icon,.printing-assigned-printer>span{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;color:#168448;background:#e8f5eb}
.printing-rule-name strong{display:block}.printing-rule-tags{display:flex;gap:5px;margin-top:4px}.printing-rule-tags em{padding:2px 7px;border-radius:999px;color:#168448;background:#e8f5eb;font-size:11px;font-style:normal}
.printing-assigned-printer{display:flex;align-items:center;gap:8px}.printing-assigned-printer small{display:block;color:var(--printing-muted);font-size:11px}
.printing-status-dot{position:relative;padding-left:14px;color:#168448;font-weight:600}.printing-status-dot::before{position:absolute;left:0;top:50%;width:7px;height:7px;border-radius:50%;background:currentColor;content:'';transform:translateY(-50%)}.printing-status-dot.is-disabled{color:#7b8790}
.printing-icon-action{border:0;background:none;color:#52616b;font-size:20px;line-height:1;cursor:pointer}.printing-icon-action--danger{color:#df3f3f}
</style>
