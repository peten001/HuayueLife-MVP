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
    expect(frame).not.toContain('MobileV2Navigation');
  });

  it('enables Mobile V2 only for canonical phone routes while retaining the old desktop shell', () => {
    const router = readFileSync(resolve(process.cwd(), 'src/router/index.ts'), 'utf8');
    const shell = readFileSync(resolve(process.cwd(), 'src/layouts/CashierShell.vue'), 'utf8');
    expect(router.match(/meta: \{ mobileV2Enabled: true \}/g)).toHaveLength(4);
    expect(shell).toContain("useMediaQuery('(max-width: 899px)')");
    expect(shell).toContain('mobileLayout.value && route.meta.mobileV2Enabled === true');
    expect(shell).toContain('<template v-else>');
  });
});
