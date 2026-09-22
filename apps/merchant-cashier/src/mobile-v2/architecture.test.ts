import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileV2Files = [
  'MobileV2Drawer.vue',
  'MobileV2Header.vue',
  'MobileV2PreviewFrame.vue',
  'MobileV2BillActionDock.vue',
  'navigation.ts',
  'routes.ts',
  'pages/MobileV2TablesPage.vue',
  'pages/MobileV2PickupPage.vue',
  'pages/MobileV2DeliveryPage.vue',
  'pages/MobileV2HistoryPage.vue',
].map((file) => readFileSync(resolve(process.cwd(), 'src/mobile-v2', file), 'utf8'));

describe('isolated Mobile V2 architecture', () => {
  it('does not own a second API, store, controller, checkout, or printing implementation', () => {
    const source = mobileV2Files.join('\n');
    expect(source).not.toMatch(/from ['"]@\/(api|stores)(?:['"/])/);
    expect(source).not.toContain('createMerchantTableOrder');
    expect(source).not.toContain('checkoutSelectedSession');
    expect(source).not.toContain('useDineInCanonicalStateController');
    expect(source).not.toContain('printTableBill(');
  });

  it('adapts the incumbent route-owned pages instead of cloning their logic', () => {
    const pages = mobileV2Files.slice(-4).join('\n');
    expect(pages).toContain("import TableOverviewPage from '@/pages/TableOverviewPage.vue';");
    expect(pages).toContain("import PickupOrdersPage from '@/pages/PickupOrdersPage.vue';");
    expect(pages).toContain("import DeliveryOrdersPage from '@/pages/DeliveryOrdersPage.vue';");
    expect(pages).toContain("import OrderHistoryPage from '@/pages/OrderHistoryPage.vue';");
  });

  it('keeps every preview route behind the Vite development gate', () => {
    const routes = readFileSync(resolve(process.cwd(), 'src/mobile-v2/routes.ts'), 'utf8');
    expect(routes).toContain('import.meta.env.DEV');
    expect(routes).toContain("path: '__preview/mobile-v2/tables/:tableId?'");
    expect(routes).not.toContain("path: 'tables/:tableId?'");
  });

  it('moves canonical destinations into the drawer while preserving the development preview namespace', () => {
    const drawer = readFileSync(resolve(process.cwd(), 'src/mobile-v2/MobileV2Drawer.vue'), 'utf8');
    const header = readFileSync(resolve(process.cwd(), 'src/mobile-v2/MobileV2Header.vue'), 'utf8');
    const frame = readFileSync(resolve(process.cwd(), 'src/mobile-v2/MobileV2PreviewFrame.vue'), 'utf8');
    const styles = readFileSync(resolve(process.cwd(), 'src/mobile-v2/mobile-v2.css'), 'utf8');
    expect(drawer).toContain("name: 'pickup-orders'");
    expect(drawer).toContain("name: 'delivery-orders'");
    expect(drawer).toContain("name: 'order-history'");
    expect(drawer).toContain('resolveCashierPresentationLocation(previewRoute.value');
    expect(drawer).toContain('Globe2');
    expect(drawer).toContain('setLocale');
    expect(header).toContain('yunqiao-cashier-mark.png');
    expect(header).toContain('>YunQiao</strong>');
    expect(header).toContain('mobile-v2-header__refresh');
    expect(header).not.toContain('mobile-v2-filter-strip__refresh');
    expect(header).not.toContain('cashierV2.tablesTab');
    expect(header).not.toContain('cashierV2.menuTab');
    expect(header).not.toContain('Globe2');
    expect(header).toContain("(workspace === 'pickup' || workspace === 'delivery') && !detailMode");
    expect(frame).toContain('const fulfillmentDetailMode = computed(() => (');
    expect(frame).toContain(':detail-mode="fulfillmentDetailMode"');
    expect(frame).toContain('const mobileV2LogicalViewportWidth = 390;');
    expect(frame).toContain('content: `width=${mobileV2LogicalViewportWidth}, user-scalable=no');
    expect(frame).toContain('function syncMobileV2LogicalCanvas()');
    expect(frame).toContain("window.visualViewport?.addEventListener('resize', scheduleMobileV2LogicalCanvasSync)");
    expect(frame).not.toContain('width=device-width');
    expect(styles).toContain('zoom: var(--mobile-v2-layout-scale);');
    expect(styles).toContain('.fulfillment-main__topbar .mobile-workspace-back');
    expect(styles).toMatch(/\.pickup-order-detail > \.fulfillment-facts\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
    expect(styles).toMatch(/\.order-items-section \.workflow-item-list > article\s*\{[^}]*grid-template-columns:\s*minmax\(0, max-content\) auto auto minmax\(18px, 1fr\) auto;/s);
    expect(styles).toMatch(/\.order-items-section \.workflow-item-list__unit-price\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/s);
    expect(styles).toMatch(/\.order-items-section \.workflow-item-list__quantity\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;/s);
    expect(styles).toMatch(/\.order-items-section \.workflow-item-list > article > b\s*\{[^}]*grid-column:\s*5;[^}]*grid-row:\s*1;/s);
    expect(styles).toMatch(/\.history-detail__identity\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap;/s);
    expect(styles).toMatch(/\.is-fulfillment-detail-mode \.fulfillment-main\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s);
    expect(frame).not.toContain('MobileV2Navigation');
  });

  it('enables Mobile V2 only for canonical phone routes while retaining the old desktop shell', () => {
    const index = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const router = readFileSync(resolve(process.cwd(), 'src/router/index.ts'), 'utf8');
    const shell = readFileSync(resolve(process.cwd(), 'src/layouts/CashierShell.vue'), 'utf8');
    expect(index).toContain('const mobileV2LogicalViewportWidth = 390;');
    expect(index).toContain('`width=${mobileV2LogicalViewportWidth}, user-scalable=no');
    expect(index).not.toContain("'width=device-width, initial-scale=1, maximum-scale=1");
    expect(router.match(/meta: \{ mobileV2Enabled: true \}/g)).toHaveLength(4);
    expect(shell).toContain("useMediaQuery('(max-width: 899px)')");
    expect(shell).toContain('mobileLayout.value && route.meta.mobileV2Enabled === true');
    expect(shell).toContain(':mobile="mobileV2Presentation"');
    expect(shell).toContain('<template v-else>');
  });
});
