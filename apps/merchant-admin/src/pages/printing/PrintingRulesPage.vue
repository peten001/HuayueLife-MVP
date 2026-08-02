<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { getCategories } from '@/api/merchant';
import {
  getPrintingPrinters,
  getPrintingRouting,
  updatePrintingRouting,
} from '@/api/printing';
import type {
  PrintingPrinter,
  PrintingRouting,
  PrintingRoutingPrinter,
} from '@/types/printing';
import type { Category } from '@/types/api';
import { PRINTING_STATE_CHANGED_EVENT } from '@/utils/printing-status';
import { lanPrinterIsOnline } from '@/utils/lan-printer-admin-state';

type RoutingScene = 'FRONT_DESK' | 'KITCHEN';

const printers = ref<PrintingPrinter[]>([]);
const categories = ref<Category[]>([]);
const routing = ref<PrintingRouting>(emptyRouting());
const loading = ref(true);
const saving = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');
const assignScene = ref<RoutingScene | null>(null);
const assignDialog = ref<HTMLDivElement | null>(null);
let assignReturnFocus: HTMLElement | null = null;

const frontDeskPrinters = computed(() => printersFor('FRONT_DESK'));
const kitchenPrinters = computed(() => printersFor('KITCHEN'));
const activeCategories = computed(() => categories.value.filter((category) => category.isActive));
const assignablePrinters = computed(() =>
  assignScene.value
    ? printers.value.filter((printer) => !routingEntry(assignScene.value!, printer.id))
    : [],
);
const kitchenConfigurationIncomplete = computed(() =>
  routing.value.kitchenPrinters.some((entry) => entry.categoryIds.length > 0)
    && !routing.value.defaultKitchenPrinterId,
);

function emptyRouting(): PrintingRouting {
  return {
    configured: false,
    checkoutDefaultPrinterId: null,
    defaultKitchenPrinterId: null,
    frontDeskPrinters: [],
    kitchenPrinters: [],
  };
}

function sceneEntries(scene: RoutingScene) {
  return scene === 'FRONT_DESK'
    ? routing.value.frontDeskPrinters
    : routing.value.kitchenPrinters;
}

function printersFor(scene: RoutingScene) {
  return sceneEntries(scene)
    .map((entry) => printers.value.find((printer) => printer.id === entry.printerId))
    .filter((printer): printer is PrintingPrinter => Boolean(printer));
}

function routingEntry(scene: RoutingScene, printerId: string) {
  return sceneEntries(scene).find((entry) => entry.printerId === printerId);
}

function ensureRoutingEntry(scene: RoutingScene, printerId: string) {
  let entry = routingEntry(scene, printerId);
  if (!entry) {
    entry = { printerId, newOrderAutoPrint: false, categoryIds: [] };
    sceneEntries(scene).push(entry);
  }
  return entry;
}

function printerName(printer: PrintingPrinter) {
  const name = printer.name?.trim();
  // Historical local test data may contain a locale token rather than a device
  // name. It must never become the visible printer name.
  return name && !/^(zh|vi|en)$/i.test(name)
    ? name
    : `打印机 #${printer.id}（名称待设置）`;
}

function connectionLabel(printer: PrintingPrinter) {
  const labels: Record<string, string> = {
    LOCAL_USB_ESCPOS: 'USB 打印',
    LOCAL_LAN_ESCPOS: '局域网打印',
    CLOUD_FEIE: '飞鹅云打印',
    CLOUD_YILIAN: '易联云打印',
    CLOUD_XINYE: '芯烨云打印',
    CLOUD_GPRINTER: '佳博云打印',
    BUILTIN_SUNMI: '商米内置打印',
    BUILTIN_IMIN: 'iMin 内置打印',
  };
  return labels[printer.channelType] ?? printer.channelType;
}

function onlineLabel(printer: PrintingPrinter) {
  if (printer.channelType === 'LOCAL_LAN_ESCPOS') return lanPrinterIsOnline(printer) ? '在线' : '离线';
  return printer.status === 'ONLINE' ? '在线' : '离线';
}

function usageLabel(printerId: string) {
  const front = Boolean(routingEntry('FRONT_DESK', printerId));
  const kitchen = Boolean(routingEntry('KITCHEN', printerId));
  if (front && kitchen) return '前台 + 厨房';
  return front ? '已用于前台' : kitchen ? '已用于厨房' : '未配置用途';
}

function autoPrintEnabled(scene: RoutingScene, printerId: string) {
  return routingEntry(scene, printerId)?.newOrderAutoPrint ?? false;
}

function categoryIdsFor(printerId: string) {
  return routingEntry('KITCHEN', printerId)?.categoryIds ?? [];
}

function toggleAutoPrint(scene: RoutingScene, printerId: string) {
  const entry = ensureRoutingEntry(scene, printerId);
  entry.newOrderAutoPrint = !entry.newOrderAutoPrint;
}

function toggleCategory(printerId: string, categoryId: string) {
  const entry = ensureRoutingEntry('KITCHEN', printerId);
  const ids = new Set(entry.categoryIds);
  if (ids.has(categoryId)) {
    ids.delete(categoryId);
  } else {
    // A category has one enabled kitchen destination. Changing the chip moves
    // that category within the staged kitchen configuration before save.
    for (const printer of kitchenPrinters.value) {
      if (printer.id === printerId) continue;
      const other = routingEntry('KITCHEN', printer.id);
      if (other) other.categoryIds = other.categoryIds.filter((id) => id !== categoryId);
    }
    ids.add(categoryId);
  }
  entry.categoryIds = [...ids];
}

function setCheckoutDefault(printerId: string) {
  routing.value.checkoutDefaultPrinterId = routing.value.checkoutDefaultPrinterId === printerId
    ? null
    : printerId;
}

function setKitchenDefault(printerId: string) {
  routing.value.defaultKitchenPrinterId = routing.value.defaultKitchenPrinterId === printerId
    ? null
    : printerId;
}

function openAssign(scene: RoutingScene) {
  assignReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  assignScene.value = scene;
  void nextTick(() => assignDialog.value?.focus());
}

function closeAssign() {
  assignScene.value = null;
  const target = assignReturnFocus;
  assignReturnFocus = null;
  void nextTick(() => target?.isConnected && target.focus());
}

function assignPrinter(printerId: string) {
  if (!assignScene.value) return;
  ensureRoutingEntry(assignScene.value, printerId);
  closeAssign();
}

function removeFromConfiguration(scene: RoutingScene, printer: PrintingPrinter) {
  if (scene === 'FRONT_DESK') {
    routing.value.frontDeskPrinters = routing.value.frontDeskPrinters.filter(
      (entry) => entry.printerId !== printer.id,
    );
    if (routing.value.checkoutDefaultPrinterId === printer.id) {
      routing.value.checkoutDefaultPrinterId = null;
    }
    return;
  }
  routing.value.kitchenPrinters = routing.value.kitchenPrinters.filter(
    (entry) => entry.printerId !== printer.id,
  );
  if (routing.value.defaultKitchenPrinterId === printer.id) {
    routing.value.defaultKitchenPrinterId = null;
  }
}

async function load() {
  try {
    loading.value = true;
    const [nextPrinters, nextCategories, nextRouting] = await Promise.all([
      getPrintingPrinters(),
      getCategories(),
      getPrintingRouting(),
    ]);
    printers.value = nextPrinters;
    categories.value = nextCategories;
    routing.value = nextRouting;
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

async function saveConfiguration() {
  try {
    saving.value = true;
    message.value = '';
    routing.value = await updatePrintingRouting({
      checkoutDefaultPrinterId: routing.value.checkoutDefaultPrinterId,
      defaultKitchenPrinterId: routing.value.defaultKitchenPrinterId,
      frontDeskPrinters: routing.value.frontDeskPrinters.map((entry) => ({
        ...entry,
        categoryIds: [],
      })),
      kitchenPrinters: routing.value.kitchenPrinters,
    });
    await load();
    window.dispatchEvent(new Event(PRINTING_STATE_CHANGED_EVENT));
    messageType.value = 'success';
    message.value = '自动打印配置已保存，并已重新加载验证。';
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

function showError(error: unknown) {
  messageType.value = 'error';
  message.value = errorMessage(error) || '保存失败，请检查打印机状态和分类绑定后重试。';
}

onMounted(() => { void load(); });
</script>

<template>
  <section class="printing-auto-page" aria-label="自动打印">
    <header class="printing-auto-page__header">
      <div>
        <h2>自动打印</h2>
        <p>分别配置前台完整订单和厨房分类小票；同一台物理打印机可同时用于两种场景。</p>
      </div>
      <div class="printing-auto-page__actions">
        <button class="printing-button printing-button--secondary" type="button" :disabled="saving" @click="load">刷新</button>
        <button class="printing-button" type="button" :disabled="saving || loading" @click="saveConfiguration">
          {{ saving ? '保存中…' : '保存自动打印配置' }}
        </button>
      </div>
    </header>

    <p v-if="message" :class="['printing-auto-message', `is-${messageType}`]" role="status">{{ message }}</p>
    <div v-if="kitchenConfigurationIncomplete" class="printing-auto-warning" role="alert">
      <strong>厨房配置不完整</strong>
      <span>已绑定菜品分类，但尚未设置默认厨房打印机；未匹配菜品不会被静默漏打。</span>
    </div>

    <section class="printer-purpose-section" aria-labelledby="front-desk-printers-title">
      <header class="printer-purpose-section__header">
        <div><h3 id="front-desk-printers-title">前台打印机</h3><p>打印完整堂食、自取、配送订单和结账小票。</p></div>
        <button class="printing-button printing-button--secondary" type="button" :disabled="saving" @click="openAssign('FRONT_DESK')">添加前台打印机</button>
      </header>
      <div v-if="loading" class="printer-purpose-empty">正在读取打印机配置…</div>
      <div v-else-if="frontDeskPrinters.length" class="printer-purpose-grid">
        <article v-for="printer in frontDeskPrinters" :key="`front-${printer.id}`" class="printer-purpose-card">
          <header><div class="printer-purpose-card__title"><strong>{{ printerName(printer) }}</strong><span>{{ connectionLabel(printer) }}</span></div><span :class="['printer-status', { 'is-online': onlineLabel(printer) === '在线' }]">{{ onlineLabel(printer) }}</span></header>
          <div class="printer-purpose-card__usage"><span>{{ usageLabel(printer.id) }}</span></div>
          <div class="printer-purpose-card__line"><span>新订单自动打印</span><button :class="['auto-switch', { 'is-on': autoPrintEnabled('FRONT_DESK', printer.id) }]" type="button" role="switch" :aria-checked="autoPrintEnabled('FRONT_DESK', printer.id)" :disabled="saving || !printer.enabled" @click="toggleAutoPrint('FRONT_DESK', printer.id)"><i /></button></div>
          <div class="printer-purpose-card__footer"><button :class="['text-action', { 'is-selected': routing.checkoutDefaultPrinterId === printer.id }]" type="button" :disabled="saving || !printer.enabled" @click="setCheckoutDefault(printer.id)">{{ routing.checkoutDefaultPrinterId === printer.id ? '已设为结账默认打印机' : '设为结账默认打印机' }}</button><button class="text-action text-action--danger" type="button" :disabled="saving" @click="removeFromConfiguration('FRONT_DESK', printer)">从前台配置中移除</button></div>
        </article>
      </div>
      <div v-else class="printer-purpose-empty"><p>尚未配置前台打印机。</p><button class="printing-button printing-button--secondary" type="button" :disabled="saving" @click="openAssign('FRONT_DESK')">添加前台打印机</button></div>
    </section>

    <section class="printer-purpose-section" aria-labelledby="kitchen-printers-title">
      <header class="printer-purpose-section__header">
        <div><h3 id="kitchen-printers-title">厨房打印机</h3><p>按菜品分类分单；未匹配分类的菜品交由默认厨房打印机。</p></div>
        <button class="printing-button printing-button--secondary" type="button" :disabled="saving" @click="openAssign('KITCHEN')">添加厨房打印机</button>
      </header>
      <div v-if="loading" class="printer-purpose-empty">正在读取打印机配置…</div>
      <div v-else-if="kitchenPrinters.length" class="printer-purpose-grid">
        <article v-for="printer in kitchenPrinters" :key="`kitchen-${printer.id}`" class="printer-purpose-card printer-purpose-card--kitchen">
          <header><div class="printer-purpose-card__title"><strong>{{ printerName(printer) }}</strong><span>{{ connectionLabel(printer) }}</span></div><span :class="['printer-status', { 'is-online': onlineLabel(printer) === '在线' }]">{{ onlineLabel(printer) }}</span></header>
          <div class="printer-purpose-card__usage"><span>{{ usageLabel(printer.id) }}</span></div>
          <div class="printer-purpose-card__line"><span>新订单自动打印</span><button :class="['auto-switch', { 'is-on': autoPrintEnabled('KITCHEN', printer.id) }]" type="button" role="switch" :aria-checked="autoPrintEnabled('KITCHEN', printer.id)" :disabled="saving || !printer.enabled" @click="toggleAutoPrint('KITCHEN', printer.id)"><i /></button></div>
          <div class="category-binding"><span>绑定菜品分类</span><div v-if="activeCategories.length" class="category-binding__chips"><button v-for="category in activeCategories" :key="category.id" :class="['category-chip', { 'is-selected': categoryIdsFor(printer.id).includes(category.id) }]" type="button" :aria-pressed="categoryIdsFor(printer.id).includes(category.id)" :disabled="saving || !printer.enabled" @click="toggleCategory(printer.id, category.id)">{{ category.nameZh }}</button></div><em v-else>暂无可绑定的菜品分类</em></div>
          <div class="printer-purpose-card__footer"><button :class="['text-action', { 'is-selected': routing.defaultKitchenPrinterId === printer.id }]" type="button" :disabled="saving || !printer.enabled" @click="setKitchenDefault(printer.id)">{{ routing.defaultKitchenPrinterId === printer.id ? '已设为默认厨房打印机' : '设为默认厨房打印机' }}</button><button class="text-action text-action--danger" type="button" :disabled="saving" @click="removeFromConfiguration('KITCHEN', printer)">从厨房配置中移除</button></div>
        </article>
      </div>
      <div v-else class="printer-purpose-empty"><p>尚未配置厨房打印机。</p><button class="printing-button printing-button--secondary" type="button" :disabled="saving" @click="openAssign('KITCHEN')">添加厨房打印机</button></div>
    </section>
  </section>

  <div v-if="assignScene" class="printing-assign-backdrop" @click.self="closeAssign" @keydown.esc="closeAssign">
    <div ref="assignDialog" class="printing-assign-dialog" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="assign-printer-title">
      <header><div><h2 id="assign-printer-title">{{ assignScene === 'FRONT_DESK' ? '添加前台打印机' : '添加厨房打印机' }}</h2><p>仅选择当前商家已有的打印机，不在这里新增物理打印机。</p></div><button type="button" aria-label="关闭" @click="closeAssign">×</button></header>
      <div v-if="assignablePrinters.length" class="printing-assign-list"><button v-for="printer in assignablePrinters" :key="printer.id" type="button" @click="assignPrinter(printer.id)"><span><strong>{{ printerName(printer) }}</strong><small>{{ connectionLabel(printer) }} · {{ onlineLabel(printer) }}</small></span><em>{{ usageLabel(printer.id) }}</em></button></div>
      <div v-else class="printing-assign-empty">没有可添加的现有打印机。</div>
    </div>
  </div>
</template>

<style scoped>
.printing-auto-page{display:grid;gap:18px}.printing-auto-page__header,.printer-purpose-section__header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.printing-auto-page__header h2,.printer-purpose-section h3{margin:0;color:var(--printing-ink);font-size:20px}.printing-auto-page__header p,.printer-purpose-section p{margin:5px 0 0;color:var(--printing-muted);font-size:13px}.printing-auto-page__actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px}.printing-auto-message,.printing-auto-warning{display:flex;gap:9px;align-items:flex-start;margin:0;padding:11px 13px;border:1px solid;border-radius:10px;font-size:13px}.printing-auto-message.is-success{border-color:#b9dfc4;color:#17693c;background:#f1faf3}.printing-auto-message.is-error{border-color:#f1c6c2;color:#ab3128;background:#fff7f6}.printing-auto-warning{border-color:#f1d497;color:#8a5a00;background:#fff9eb}.printer-purpose-section{display:grid;gap:13px;padding:18px;border:1px solid var(--printing-border);border-radius:12px;background:#fff}.printer-purpose-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.printer-purpose-card{display:grid;gap:13px;padding:15px;border:1px solid #e1e9e3;border-radius:11px;background:#fbfdfb}.printer-purpose-card--kitchen{background:#fcfefc}.printer-purpose-card>header,.printer-purpose-card__line,.printer-purpose-card__footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.printer-purpose-card__title{min-width:0}.printer-purpose-card__title strong,.printer-purpose-card__title span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.printer-purpose-card__title strong{color:var(--printing-ink);font-size:15px}.printer-purpose-card__title span{margin-top:4px;color:var(--printing-muted);font-size:12px}.printer-status{flex:0 0 auto;color:#8a5a00;font-size:12px;font-weight:700}.printer-status.is-online{color:#168448}.printer-purpose-card__usage span{display:inline-flex;padding:3px 7px;border-radius:999px;color:#17693c;background:#e9f6ed;font-size:11px;font-weight:700}.printer-purpose-card__line{padding-block:2px;color:var(--printing-ink);font-size:13px}.auto-switch{position:relative;width:42px;height:24px;flex:0 0 42px;padding:0;border:0;border-radius:999px;background:#cfd8d2;cursor:pointer;transition:background .16s ease}.auto-switch i{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #10213d33;transition:transform .16s ease}.auto-switch.is-on{background:#159447}.auto-switch.is-on i{transform:translateX(18px)}.auto-switch:disabled{opacity:.48;cursor:not-allowed}.category-binding{display:grid;gap:8px;padding:10px;border:1px dashed #cfdbd2;border-radius:9px}.category-binding>span,.category-binding em{color:var(--printing-muted);font-size:12px;font-style:normal}.category-binding__chips{display:flex;flex-wrap:wrap;gap:7px}.category-chip{border:1px solid #d8e3da;border-radius:999px;background:#fff;color:#4f6155;padding:5px 9px;font-size:12px;cursor:pointer}.category-chip.is-selected{border-color:#9bd1aa;background:#edf8ef;color:#17693c;font-weight:700}.category-chip:disabled{opacity:.55;cursor:not-allowed}.printer-purpose-card__footer{align-items:flex-start;padding-top:2px}.text-action{border:0;background:none;color:#17693c;padding:0;font-size:12px;font-weight:700;line-height:1.45;text-align:left;cursor:pointer}.text-action.is-selected{color:#0f7040}.text-action--danger{color:#a3443d}.text-action:disabled{opacity:.5;cursor:not-allowed}.printer-purpose-empty{display:flex;min-height:92px;flex-direction:column;align-items:flex-start;justify-content:center;gap:9px;padding:16px;border:1px dashed #d8e3da;border-radius:10px;color:var(--printing-muted);background:#fbfdfb;font-size:13px}.printer-purpose-empty p{margin:0}.printing-assign-backdrop{position:fixed;z-index:30;inset:0;display:grid;place-items:center;padding:20px;background:#10213d55}.printing-assign-dialog{width:min(560px,100%);max-height:min(640px,calc(100vh - 40px));overflow:auto;border-radius:14px;background:#fff;box-shadow:0 20px 56px #10213d40}.printing-assign-dialog>header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:20px;border-bottom:1px solid #e5ece7}.printing-assign-dialog h2{margin:0;color:var(--printing-ink);font-size:18px}.printing-assign-dialog p{margin:5px 0 0;color:var(--printing-muted);font-size:13px}.printing-assign-dialog>header>button{width:32px;height:32px;border:0;border-radius:8px;color:#52616b;background:#f2f5f3;font-size:22px;line-height:1;cursor:pointer}.printing-assign-list{display:grid;padding:12px}.printing-assign-list>button{display:flex;align-items:center;justify-content:space-between;gap:12px;border:0;border-radius:9px;background:transparent;padding:12px;text-align:left;cursor:pointer}.printing-assign-list>button:hover,.printing-assign-list>button:focus-visible{background:#edf8ef;outline:none}.printing-assign-list strong,.printing-assign-list small{display:block}.printing-assign-list strong{color:var(--printing-ink);font-size:14px}.printing-assign-list small,.printing-assign-list em{margin-top:3px;color:var(--printing-muted);font-size:12px;font-style:normal}.printing-assign-empty{padding:28px 20px;color:var(--printing-muted);font-size:13px}@media(max-width:900px){.printing-auto-page__header,.printer-purpose-section__header{display:grid}.printing-auto-page__actions{justify-content:flex-start}.printer-purpose-grid{grid-template-columns:1fr}}@media(max-width:560px){.printer-purpose-section{padding:14px}.printer-purpose-card__footer{display:grid}.printing-auto-page__actions .printing-button{width:100%}}
</style>
