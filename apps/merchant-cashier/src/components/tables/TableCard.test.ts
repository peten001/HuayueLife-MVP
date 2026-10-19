import { mount } from '@vue/test-utils';
import type { ArrivalReservation } from '@huayue-life/shared';
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

  it('keeps an available table to table number and status without placeholder metadata', () => {
    const wrapper = mount(TableCard, {
      props: { table: { ...disabledTable(null), status: 'ACTIVE', operationalStatus: 'AVAILABLE' } },
    });

    expect(wrapper.text()).toContain('A01');
    expect(wrapper.text()).toContain('空闲');
    expect(wrapper.find('.table-card__meta').exists()).toBe(false);
    expect(wrapper.find('.table-card__amount').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('—');
  });

  it('shows a planned visit without changing an available table to occupied', async () => {
    const wrapper = mount(TableCard, { props: {
      table: { ...disabledTable(null), status: 'ACTIVE', operationalStatus: 'AVAILABLE' },
      reservations: [{ id: 'r1', kind: 'DINE_IN', status: 'CONFIRMED', scheduledFor: '2026-10-20T12:00:00Z', contactName: '王先生', guestCount: 4 } as ArrivalReservation],
    } });
    expect(wrapper.attributes('data-status')).toBe('AVAILABLE');
    expect(wrapper.get('[data-testid="table-reservation-hint"]').text()).toContain('19:00');
    expect(wrapper.text()).toContain('王先生');
    expect(wrapper.find('.table-card__amount').exists()).toBe(false);
    await wrapper.trigger('click');
    expect(wrapper.emitted('select')).toEqual([['table-1']]);
  });

  it('shows only real occupied-session duration, order, dish and amount data', () => {
    const wrapper = mount(TableCard, {
      props: {
        table: {
          ...disabledTable({
            id: 'session-1',
            sessionNo: 'S-1',
            merchantId: 'merchant-1',
            tableId: 'table-1',
            tableNo: 'A01',
            status: 'OPEN',
            openedAt: new Date(Date.now() - 35 * 60_000).toISOString(),
            orderCount: 2,
            itemCount: 5,
            totalAmountVnd: '168000',
            pendingOrderCount: 0,
            unfinishedOrderCount: 2,
          }),
          status: 'ACTIVE',
          operationalStatus: 'IN_USE',
        },
      },
    });

    expect(wrapper.get('.table-card__meta').text()).toContain('35分');
    expect(wrapper.get('.table-card__orders').text()).toContain('2单 · 5菜');
    expect(wrapper.get('.table-card__amount').text()).toContain('168,000');
    expect(wrapper.text()).not.toContain('—');
  });
});
