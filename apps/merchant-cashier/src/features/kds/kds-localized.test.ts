import { describe, expect, it } from 'vitest';
import { kdsStationInput, kdsStationLabel, kdsSystemMessage, kdsUnitLabel } from './kds-localized';

describe('KDS localized data labels', () => {
  it.each(['vi', 'en'] as const)('round-trips station editing in %s without renaming persisted keys or custom stations', locale => {
    const original = ['热厨', '烧烤档', '粉面档', '吧台', 'VIP 专用'];
    const displayed = original.map(name => kdsStationLabel(locale, name, original)).join(', ');
    expect(displayed).not.toContain('热厨');
    expect(kdsStationInput(locale, displayed, original)).toBe(original.join(', '));
    expect(kdsStationInput(locale, displayed + ', ', original)).toBe(original.join(', ') + ', ');
    expect(kdsStationLabel(locale, 'VIP 专用')).toBe('VIP 专用');
    expect(kdsStationInput(locale, displayed + ', Bếp riêng', original)).toBe(original.join(', ') + ', Bếp riêng');
  });
  it('disambiguates a translated built-in name from an existing custom name', () => {
    const original = ['烧烤档', 'Grill'];
    const labels = original.map(name => kdsStationLabel('en', name, original));
    expect(new Set(labels).size).toBe(2);
    expect(labels[1]).toBe('Grill');
    expect(kdsStationInput('en', labels.join(', '), original)).toBe(original.join(', '));
  });
  it('translates standard units and system reasons while preserving merchant/customer free text', () => {
    expect(kdsUnitLabel('vi', '串')).toBe('xiên');
    expect(kdsUnitLabel('en', '碗')).toBe('bowls');
    expect(kdsUnitLabel('zh', '杯')).toBe('杯');
    expect(kdsUnitLabel('vi', '大份（双人）')).toBe('大份（双人）');
    expect(kdsSystemMessage('en', '订单数量调整')).toBe('Order quantity adjusted');
    expect(kdsSystemMessage('vi', '顾客要求不放香菜')).toBe('顾客要求不放香菜');
    expect(kdsStationLabel('en', 'constructor')).toBe('constructor');
  });
});
