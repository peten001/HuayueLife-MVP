import { describe, expect, it } from 'vitest';
import { resolveLocalizedOrderItemName } from './localized-order-item';

const translated = {
  productNameZhSnapshot: '小炒肉',
  productNameViSnapshot: 'Thịt xào',
  productNameEnSnapshot: 'Stir-fried pork',
};

describe('resolveLocalizedOrderItemName', () => {
  it.each([
    ['zh' as const, '小炒肉'],
    ['vi' as const, 'Thịt xào'],
    ['en' as const, 'Stir-fried pork'],
  ])('prefers the %s snapshot name', (locale, expected) => {
    expect(resolveLocalizedOrderItemName(translated, locale, '菜品')).toBe(expected);
  });

  it('falls back from a missing locale without returning blank text', () => {
    expect(resolveLocalizedOrderItemName({ ...translated, productNameViSnapshot: ' ' }, 'vi', '菜品')).toBe('小炒肉');
  });

  it('prefers a translated snapshot over the related product name', () => {
    expect(resolveLocalizedOrderItemName({ ...translated, productNameVi: 'Tên hiện tại' }, 'vi', '菜品')).toBe('Thịt xào');
  });

  it('uses the related product translation when the snapshot translation is absent', () => {
    expect(resolveLocalizedOrderItemName({ productNameZhSnapshot: '小炒肉', productNameVi: 'Thịt xào hiện tại' }, 'vi', '菜品')).toBe('Thịt xào hiện tại');
  });

  it('returns a safe fallback when every name field is missing', () => {
    expect(resolveLocalizedOrderItemName({}, 'en', 'Unnamed item')).toBe('Unnamed item');
    expect(resolveLocalizedOrderItemName({}, 'en', ' ')).toBe('—');
  });

  it('changes its result immediately when locale changes', () => {
    expect(['zh', 'vi', 'en'].map((locale) => resolveLocalizedOrderItemName(translated, locale as 'zh' | 'vi' | 'en', '菜品')))
      .toEqual(['小炒肉', 'Thịt xào', 'Stir-fried pork']);
  });
});
