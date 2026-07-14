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
});
