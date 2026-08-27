import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import CashierHeader from './CashierHeader.vue';

function mountHeader() {
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
    },
  });
}

describe('CashierHeader main table and menu tabs', () => {
  let wrapper: ReturnType<typeof mountHeader> | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
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

  it('keeps the content-level table page free of a duplicate main tab instance', () => {
    const pagePath = resolve(process.cwd(), 'src/pages/TableOverviewPage.vue');
    const source = readFileSync(pagePath, 'utf8');
    expect(source).not.toContain('data-testid="main-tab-tables"');
    expect(source).not.toContain('data-testid="main-tab-menu"');
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
