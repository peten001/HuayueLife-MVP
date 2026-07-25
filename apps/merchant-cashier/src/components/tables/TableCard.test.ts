import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { TableCardView } from '@/types';
import TableCard from './TableCard.vue';

function disabledTable(currentSession: TableCardView['currentSession']): TableCardView {
  return {
    id: 'table-1',
    merchantId: 'merchant-1',
    tableNo: 'A01',
    tableName: 'A01',
    qrToken: 'not-a-real-token',
    qrVersion: 1,
    status: 'DISABLED',
    operationalStatus: 'DISABLED',
    canCloseSession: false,
    currentSession,
  };
}

describe('TableCard disabled-table recovery', () => {
  it('keeps the mature card selectable while a disabled table still owns an open session', async () => {
    const wrapper = mount(TableCard, {
      props: {
        table: disabledTable({
          id: 'session-1',
          sessionNo: 'S-1',
          merchantId: 'merchant-1',
          tableId: 'table-1',
          tableNo: 'A01',
          status: 'OPEN',
          openedAt: '2026-07-24T00:00:00.000Z',
          orderCount: 1,
          itemCount: 1,
          totalAmountVnd: '50000',
          pendingOrderCount: 0,
          unfinishedOrderCount: 1,
        }),
      },
    });

    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('select')).toEqual([['table-1']]);
  });

  it('disables the same card once the open session has been released', () => {
    const wrapper = mount(TableCard, { props: { table: disabledTable(null) } });
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });
});
