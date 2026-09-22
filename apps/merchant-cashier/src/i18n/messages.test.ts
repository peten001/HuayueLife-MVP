import { describe, expect, it } from 'vitest';
import { enMessages, viMessages, zhMessages } from './messages';

function sortedKeys(messages: Record<string, string>) {
  return Object.keys(messages).sort();
}

function placeholders(message: string) {
  return [...message.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();
}

describe('cashier translation dictionaries', () => {
  it('keeps Chinese, Vietnamese and English key sets identical', () => {
    const chineseKeys = sortedKeys(zhMessages);

    expect(sortedKeys(viMessages)).toEqual(chineseKeys);
    expect(sortedKeys(enMessages)).toEqual(chineseKeys);
  });

  it('provides a non-empty value in every language', () => {
    for (const key of Object.keys(zhMessages) as Array<keyof typeof zhMessages>) {
      expect(zhMessages[key].trim(), `zh:${key}`).not.toBe('');
      expect(viMessages[key].trim(), `vi:${key}`).not.toBe('');
      expect(enMessages[key].trim(), `en:${key}`).not.toBe('');
    }
  });

  it('keeps interpolation placeholders consistent across languages', () => {
    for (const key of Object.keys(zhMessages) as Array<keyof typeof zhMessages>) {
      const expected = placeholders(zhMessages[key]);

      expect(placeholders(viMessages[key]), `vi:${key}`).toEqual(expected);
      expect(placeholders(enMessages[key]), `en:${key}`).toEqual(expected);
    }
  });

  it('uses the real compact Vietnamese table states without a fake close-ready state', () => {
    expect([
      viMessages['common.all'],
      viMessages['table.status.available'],
      viMessages['table.status.inUse'],
      viMessages['table.status.disabled'],
    ]).toEqual(['Tất cả', 'Trống', 'Đang dùng', 'Đã tắt']);
    expect('table.status.readyToClose' in viMessages).toBe(false);
  });

  it('exposes the four real printing states in all supported languages', () => {
    expect([
      zhMessages['print.disabled'],
      zhMessages['print.configurationRequired'],
      zhMessages['print.terminalOffline'],
      zhMessages['print.ready'],
    ]).toEqual(['打印功能未开通', '打印机未配置', '打印设备离线', '可以打印']);

    for (const messages of [viMessages, enMessages]) {
      expect(messages['print.disabled']).not.toBe(messages['print.configurationRequired']);
      expect(messages['print.configurationRequired']).not.toBe(messages['print.terminalOffline']);
      expect(messages['print.terminalOffline']).not.toBe(messages['print.ready']);
    }
  });

  it('keeps active and history filter labels compact and unambiguous', () => {
    expect(zhMessages['filter.orderTypeAll']).toBe('全部订单');
    expect(zhMessages['filter.orderStatusAll']).toBe('全部状态');
    expect(viMessages['filter.orderTypeAll']).toBe('Mọi đơn');
    expect(viMessages['filter.orderStatusAll']).toBe('Tất cả');
    expect(enMessages['filter.orderTypeAll']).toBe('All orders');
    expect(enMessages['filter.orderStatusAll']).toBe('All status');
    expect([
      viMessages['fulfillment.deliveryAll'],
      viMessages['fulfillment.deliveryPending'],
      viMessages['fulfillment.deliveryPreparing'],
      viMessages['fulfillment.deliveryReadyShort'],
      viMessages['fulfillment.deliveryEnRoute'],
    ]).toEqual(['Tất cả', 'Chờ nhận', 'Đang làm', 'Chờ giao', 'Đang giao']);
    expect(enMessages['filter.orderStatusAll']).toBe('All status');
    expect(enMessages['fulfillment.pickupPreparing']).toBe('Making');
    expect(enMessages['fulfillment.deliveryPreparing']).toBe('Making');
  });

  it('keeps the Vietnamese date filter label complete for accessibility', () => {
    expect(viMessages['orders.filterDate']).toBe('Ngày đơn hàng');
  });

  it('localizes every compact mobile label added for the current cashier refinement', () => {
    expect([
      zhMessages['settlement.timeLabelShort'],
      zhMessages['settlement.businessDateLabelShort'],
      zhMessages['settlement.paymentLabelShort'],
      zhMessages['fulfillment.estimatedReadyShort'],
      zhMessages['fulfillment.waitingShort'],
      zhMessages['fulfillment.orderedShort'],
      zhMessages['fulfillment.addressCopied'],
      zhMessages['cashier.chat.more'],
    ]).toEqual(['时间', '营业', '支付', '取餐', '已等', '下单', '已复制', '更多']);

    expect([
      viMessages['settlement.timeLabelShort'],
      viMessages['settlement.businessDateLabelShort'],
      viMessages['settlement.paymentLabelShort'],
      viMessages['fulfillment.estimatedReadyShort'],
      viMessages['fulfillment.waitingShort'],
      viMessages['fulfillment.orderedShort'],
      viMessages['fulfillment.addressCopied'],
      viMessages['cashier.chat.more'],
    ]).toEqual(['Giờ', 'Ngày', 'Trả', 'Lấy', 'Chờ', 'Đặt', 'Đã sao chép', 'Thêm']);

    expect([
      enMessages['settlement.timeLabelShort'],
      enMessages['settlement.businessDateLabelShort'],
      enMessages['settlement.paymentLabelShort'],
      enMessages['fulfillment.estimatedReadyShort'],
      enMessages['fulfillment.waitingShort'],
      enMessages['fulfillment.orderedShort'],
      enMessages['fulfillment.addressCopied'],
      enMessages['cashier.chat.more'],
    ]).toEqual(['Time', 'Date', 'Pay', 'Pickup', 'Wait', 'Order', 'Copied', 'More']);
  });
});
