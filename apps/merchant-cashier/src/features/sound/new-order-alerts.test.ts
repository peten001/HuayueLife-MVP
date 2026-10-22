import { describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { demoKds } from '@/features/kds/kds-demo';
import { useSoundStore } from '@/stores/sound';
import { kitchenOrderAlerts } from './new-order-alerts';

describe('kitchen new order detection', () => {
  it('alerts once for several dishes/stations, but never for quantity increases or late add-dishes', () => {
    localStorage.clear(); setActivePinia(createPinia());
    const sound = useSoundStore('kds'); sound.notifyNewOrders([], 'm');
    const task = demoKds.board().tasks[0]!;
    const tasks = [task, { ...task, id: 'other', station: '热厨' }];
    expect(sound.notifyNewOrders(kitchenOrderAlerts(tasks, '', true), 'm')).toEqual([task.orderId]);
    expect(sound.notifyNewOrders(kitchenOrderAlerts([{ ...task, quantity: task.quantity + 3 }], '', true), 'm')).toEqual([]);
    expect(sound.notifyNewOrders(kitchenOrderAlerts([{ ...task, id: 'new-item', station: '吧台' }], '', true), 'm')).toEqual([]);
  });
  it('limits alerts to the current station, while modes, search, return or serving do not create new orders', () => {
    localStorage.clear(); setActivePinia(createPinia());
    const sound = useSoundStore('kds'); sound.notifyNewOrders([], 'm'); const task = demoKds.board().tasks[0]!;
    expect(sound.notifyNewOrders(kitchenOrderAlerts([task], '热厨', true), 'm')).toEqual([]);
    expect(sound.notifyNewOrders(kitchenOrderAlerts([task], task.station, true), 'm')).toEqual([]);
    const current = { ...task, orderId: 'new', order: { ...task.order, tableSessionId: 'new-session' } };
    expect(sound.notifyNewOrders(kitchenOrderAlerts([current], task.station, true), 'm')).toEqual(['new']);
    expect(sound.notifyNewOrders(kitchenOrderAlerts([{ ...current, quantity: 0, cancelledQuantity: 3 }], task.station, true), 'm')).toEqual([]);
    expect(sound.notifyNewOrders(kitchenOrderAlerts([{ ...current, madeQuantity: current.quantity }], task.station, true), 'm')).toEqual([]);
  });
  it('treats new child orders on the same dining session as add-dishes, while a reused table can ring for its new session', () => {
    localStorage.clear(); setActivePinia(createPinia()); const sound = useSoundStore('kds'); sound.notifyNewOrders([], 'm');
    const task = demoKds.board().tasks[0]!;
    expect(sound.notifyNewOrders(kitchenOrderAlerts([task], '', true), 'm')).toEqual([task.orderId]);
    expect(sound.notifyNewOrders(kitchenOrderAlerts([{ ...task, id: 'add', orderId: 'child-order' }], '', true), 'm')).toEqual([]);
    const nextSession = { ...task, orderId: 'next', order: { ...task.order, tableSessionId: 'next-session' } };
    expect(sound.notifyNewOrders(kitchenOrderAlerts([nextSession], '', true), 'm')).toEqual(['next']);
  });
  it('does not alert for KDS disabled or already completed tasks', () => {
    const task = demoKds.board().tasks[0]!;
    expect(kitchenOrderAlerts([task], '', false).some(row => row.announce)).toBe(false);
    expect(kitchenOrderAlerts([{ ...task, madeQuantity: task.quantity }], '', true).some(row => row.announce)).toBe(false);
  });
});
