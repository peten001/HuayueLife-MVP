import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import type { TableCardView } from '@/types';
import TableTransferDialog from './TableTransferDialog.vue';

const target: TableCardView = {
  id: 'table-2',
  merchantId: 'merchant-1',
  tableNo: 'A02',
  tableName: 'Window',
  qrToken: 'not-real',
  qrVersion: 1,
  status: 'ACTIVE',
  operationalStatus: 'AVAILABLE',
  currentSession: null,
  canCloseSession: false,
};

function mountDialog() {
  return mount(TableTransferDialog, {
    attachTo: document.body,
    props: { open: true, sourceLabel: 'A01', targets: [target] },
    global: { stubs: { Teleport: true } },
  });
}

describe('TableTransferDialog', () => {
  afterEach(() => {
    setLocale('zh');
    document.body.innerHTML = '';
  });

  it('requires one empty target and confirms only that target', async () => {
    const wrapper = mountDialog();
    expect(wrapper.get('.table-transfer-target-grid').findAll('[role="radio"]')).toHaveLength(1);
    const confirm = wrapper.get('[data-testid="confirm-table-transfer"]');
    expect(confirm.attributes('disabled')).toBeDefined();

    await wrapper.get('[role="radio"]').trigger('click');
    expect(wrapper.get('[data-testid="confirm-table-transfer"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-testid="confirm-table-transfer"]').trigger('click');

    expect(wrapper.emitted('confirm')).toEqual([['table-2']]);
    expect(wrapper.text()).toContain('不会结账');
    expect(wrapper.text()).toContain('不会触发打印');
    wrapper.unmount();
  });

  it('closes on Escape and restores the previous focus', async () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const wrapper = mountDialog();
    await wrapper.vm.$nextTick();

    await wrapper.get('.table-transfer-dialog').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('cancel')).toEqual([[]]);
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(before);
    wrapper.unmount();
  });
});
