import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CashierHeader from './CashierHeader.vue';

function mountHeader(overrides: Partial<InstanceType<typeof CashierHeader>['$props']> = {}) {
  return mount(CashierHeader, {
    props: {
      totalTableCount: 15,
      availableTableCount: 13,
      inUseTableCount: 1,
      disabledTableCount: 1,
      newOrderCount: 0,
      online: true,
      apiReachable: true,
      reconnecting: false,
      soundEnabled: true,
      soundSupported: true,
      printingAvailability: 'READY',
      activeTableFilter: 'ALL',
      showTableMetrics: false,
      showMainTabs: true,
      activeMainTab: 'TABLES',
      ...overrides,
    },
  });
}

function useMobileViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('CashierHeader main table and menu tabs', () => {
  let wrapper: ReturnType<typeof mountHeader> | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.unstubAllGlobals();
  });

  it('replaces the former KPI region with exactly one main tab group', async () => {
    wrapper = mountHeader();
    expect(wrapper.findAll('[data-testid="cashier-primary-tabs"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid^="main-tab-"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="top-metrics"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="cashier-toolbar-primary"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="cashier-toolbar-menu-search"]').attributes('style')).toContain('display: none');

    await wrapper.get('[data-testid="main-tab-menu"]').trigger('click');
    expect(wrapper.emitted('selectMainTab')).toEqual([['MENU']]);
  });

  it('reserves the menu-search host only for the menu tab without duplicating main tabs', async () => {
    wrapper = mountHeader();
    await wrapper.setProps({ activeMainTab: 'MENU' });

    expect(wrapper.findAll('[data-testid="cashier-primary-tabs"]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="cashier-toolbar-menu-search"]').attributes('style') || '').not.toContain('display: none');
  });

  it('keeps the mobile table route to three filters and three operational statuses only', async () => {
    useMobileViewport();
    wrapper = mountHeader();
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-testid="cashier-mobile-table-filters"] button')).toHaveLength(3);
    expect(wrapper.get('[data-testid="cashier-mobile-table-filters"]').text()).toContain('全部15');
    expect(wrapper.get('[data-testid="cashier-mobile-table-filters"]').text()).toContain('用餐中1');
    expect(wrapper.get('[data-testid="cashier-mobile-table-filters"]').text()).toContain('空闲13');
    expect(wrapper.find('[data-testid="cashier-mobile-ordering-toolbar"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="top-new-orders"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="top-fullscreen"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="top-clock"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="top-status"]').element.children).toHaveLength(3);
  });

  it('exposes only the menu search, readonly table context and four useful actions on mobile', async () => {
    useMobileViewport();
    wrapper = mountHeader({ activeMainTab: 'MENU', currentTableLabel: 'A03' });
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-testid="cashier-mobile-ordering-toolbar"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="cashier-mobile-menu-search"]')).toHaveLength(1);
    const currentTable = wrapper.get('[data-testid="cashier-mobile-current-table"]');
    expect(currentTable.element.tagName).toBe('OUTPUT');
    expect(currentTable.attributes('tabindex')).toBeUndefined();
    expect(currentTable.find('svg').exists()).toBe(false);
    expect(currentTable.text()).toContain('桌台 A03');
    expect(wrapper.find('[data-testid="cashier-mobile-table-filters"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="top-new-orders"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="top-network-status"]').text()).toContain('网络');
    expect(wrapper.get('[data-testid="top-sound-status"]').text()).toContain('声音');
    expect(wrapper.get('[data-testid="top-print-status"]').text()).toContain('打印');
    expect(wrapper.get('[data-testid="top-status"]').element.children).toHaveLength(4);

    const styles = readFileSync(resolve(process.cwd(), 'src/styles/cashier-v2-phase1.css'), 'utf8');
    const mobileV6 = styles.slice(styles.indexOf('/* Mobile header responsibility split V6 FINAL:'));
    expect(mobileV6).toMatch(/\.cashier-header--table-route \.cashier-top-status\s*\{[^}]*repeat\(3,\s*44px\);[^}]*width:\s*132px;/s);
    expect(mobileV6).toMatch(/\.cashier-header--menu-route \.cashier-top-status\s*\{[^}]*repeat\(4,\s*44px\);[^}]*width:\s*176px;/s);
  });

  it('keeps the content-level table page free of a duplicate main tab instance', () => {
    const pagePath = resolve(process.cwd(), 'src/pages/TableOverviewPage.vue');
    const source = readFileSync(pagePath, 'utf8');
    expect(source).not.toContain('data-testid="main-tab-tables"');
    expect(source).not.toContain('data-testid="main-tab-menu"');
    expect(source).toContain("v-if=\"activeMainTab === 'TABLES' && !isMobile\"");
  });

  it('keeps shared table metrics gated to the table route', () => {
    const shellPath = resolve(process.cwd(), 'src/layouts/CashierShell.vue');
    const source = readFileSync(shellPath, 'utf8');
    expect(source).toContain("const showTableMetrics = computed(() => router.currentRoute.value.name === 'tables');");
    expect(source).not.toContain("const showTableMetrics = computed(() => router.currentRoute.value.name !== 'tables');");
  });

  it('keeps the right tool rail anchored while only the menu search visibility changes', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/cashier-v2-phase1.css'), 'utf8');
    expect(styles).toContain('/* V6: one continuous POS toolbar and click-to-persist ordering.');
    expect(styles).toMatch(/\.cashier-header--main-tabs\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s);
    expect(styles).toMatch(/\.cashier-header--main-tabs \.cashier-top-status\s*\{[^}]*grid-template-columns:/s);
    expect(styles).toMatch(/\.table-ordering-workspace--embedded\s*\{\s*grid-template-rows:\s*minmax\(0, 1fr\);/s);
  });

  it('contains no menu confirmation footer in the ordering component source', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ordering/TableOrderingWorkspace.vue'), 'utf8');
    expect(source).not.toContain('<footer class="table-ordering-footer"');
    expect(source).not.toContain('confirm-table-order');
  });
});
