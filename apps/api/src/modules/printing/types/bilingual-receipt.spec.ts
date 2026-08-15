import { formatBilingualDishName } from './bilingual-receipt';

describe('formatBilingualDishName', () => {
  it('joins Vietnamese first and Chinese second with a single space', () => {
    expect(formatBilingualDishName('Trứng xào hẹ', '韭菜炒蛋'))
      .toBe('Trứng xào hẹ 韭菜炒蛋');
  });

  it('falls back to Chinese-only when Vietnamese is missing', () => {
    expect(formatBilingualDishName(null, '历史删除菜品')).toBe('历史删除菜品');
    expect(formatBilingualDishName('', '历史删除菜品')).toBe('历史删除菜品');
  });

  it('falls back to Vietnamese-only when Chinese is missing', () => {
    expect(formatBilingualDishName('Món A', undefined)).toBe('Món A');
  });

  it('does not repeat an identical bilingual name', () => {
    expect(formatBilingualDishName('Bánh mì', 'Bánh mì')).toBe('Bánh mì');
  });

  it('returns an empty string when both names are missing', () => {
    expect(formatBilingualDishName(null, null)).toBe('');
  });

  it('never emits separators or double spaces', () => {
    const value = formatBilingualDishName('  Phở bò ', ' 牛肉粉  ');
    expect(value).toBe('Phở bò 牛肉粉');
    expect(value).not.toMatch(/[/|]/);
    expect(value).not.toContain('  ');
  });
});
