import { describe, expect, it } from 'vitest';
import { productMatchesQuery } from './menu-search';

const kuanFen = {
  nameZh: '宽粉',
  nameVi: 'Miến bản rộng',
  nameEn: 'Wide noodles',
  description: '红薯粉',
};
const bunBo = {
  nameZh: '越南牛肉米粉',
  nameVi: 'Bún Bò Huế',
  nameEn: 'Hue beef noodle soup',
  description: 'Đậm vị',
};

describe('cashier unified menu search', () => {
  it.each(['k', 'K', 'kf', 'KF', 'kuan', 'kuanfen', '宽', '宽粉'])(
    'matches Chinese text, full pinyin and pinyin initials: %s',
    (query) => expect(productMatchesQuery(kuanFen, query)).toBe(true),
  );

  it.each(['b', 'B', 'bb', 'BB', 'bun', 'bun bo', 'bò', 'bo', '  BUN   BO  '])(
    'matches Vietnamese accents, folded text, tokens and initials: %s',
    (query) => expect(productMatchesQuery(bunBo, query)).toBe(true),
  );

  it.each(['Đậm', 'đậm', 'dam', 'wide noodles', 'WIDENOODLES', '红薯'])(
    'matches every language field independently of the active locale: %s',
    (query) => expect(productMatchesQuery(query.includes('wide') || query.includes('WIDE') || query.includes('红') ? kuanFen : bunBo, query)).toBe(true),
  );

  it('does not match unrelated input', () => {
    expect(productMatchesQuery(kuanFen, '咖啡')).toBe(false);
  });
});
