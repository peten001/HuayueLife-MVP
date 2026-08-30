import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileV2Files = [
  'MobileV2Navigation.vue',
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
});
