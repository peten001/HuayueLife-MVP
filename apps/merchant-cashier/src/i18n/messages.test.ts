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
});
