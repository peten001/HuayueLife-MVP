import { buildHomeRecommendations, recommendationPeriod, recommendationPhotos, RecommendationCandidate } from './home-recommendations';

function candidate(id: string, code = 'CHINESE_RESTAURANT', overrides: Partial<RecommendationCandidate['merchant']> = {}, rating: RecommendationCandidate['rating'] = null): RecommendationCandidate {
  return { merchant: { id, province: '北江', businessType: { code }, homepageCategoryKeys: [], isOpen: true, distanceKm: null, promotionTags: [], coverUrl: `/photo-${id}`, images: [], signatureDishes: [], ...overrides }, rating };
}
const at = (local: string) => new Date(`2026-10-05T${local}:00+07:00`);

describe('Automatic Vietnam home recommendations', () => {
  it.each([
    ['04:59', 'EVENING', '2026-10-04T22:00:00.000Z'],
    ['05:00', 'BREAKFAST', '2026-10-05T02:00:00.000Z'],
    ['08:59', 'BREAKFAST', '2026-10-05T02:00:00.000Z'],
    ['09:00', 'MORNING', '2026-10-05T04:00:00.000Z'],
    ['11:00', 'LUNCH', '2026-10-05T07:00:00.000Z'],
    ['14:00', 'AFTERNOON', '2026-10-05T10:00:00.000Z'],
    ['17:00', 'DINNER', '2026-10-05T14:00:00.000Z'],
    ['21:00', 'EVENING', '2026-10-05T22:00:00.000Z'],
    ['23:59', 'EVENING', '2026-10-05T22:00:00.000Z'],
  ])('switches at Vietnam %s, independent of UTC date', (time, code, endsAt) => {
    expect(recommendationPeriod(at(time))).toMatchObject({ code, endsAt });
  });

  it('limits to the selected region, without requiring curated topics', () => {
    const rows = [candidate('1'), candidate('2', 'COFFEE_TEA'), candidate('3', 'MASSAGE_SPA', { province: '北宁' })];
    const result = buildHomeRecommendations(rows, '北江', false, at('15:00'));
    expect(result.spotlights.map(item => item.kind)).toEqual(['FOOD', 'COFFEE']);
    expect(result.scenes.map(item => item.kind)).toEqual(['COFFEE']);
    expect(buildHomeRecommendations(rows, null, true, at('15:00')).spotlights).toEqual([]);
  });

  it('ranks open shops before closed ones; closed shops cannot appear as timely inspiration', () => {
    const rows = [candidate('closed', 'CHINESE_RESTAURANT', { isOpen: false, promotionTags: [{ code: 'FEATURED' }] }, { averageRating: 5, total: 100 }), candidate('open')];
    const result = buildHomeRecommendations(rows, '北江', false, at('12:00'));
    expect(result.spotlights[0].merchant.id).toBe('open');
    expect(result.scenes[0].merchant.id).toBe('open');
    const empty = buildHomeRecommendations([rows[0]], '北江', false, at('12:00'));
    expect(empty.spotlights[0].merchant.isOpen).toBe(false);
    expect(empty.scenes).toEqual([]);
  });

  it('prefers a nearby pool over distant featured shops, with 10km and regional fallback', () => {
    const near = candidate('near', 'CHINESE_RESTAURANT', { distanceKm: 2 });
    const far = candidate('far', 'CHINESE_RESTAURANT', { distanceKm: 20, promotionTags: [{ code: 'FEATURED' }] });
    const unknown = candidate('unknown', 'CHINESE_RESTAURANT', {}, { averageRating: 5, total: 50 });
    expect(buildHomeRecommendations([far, unknown, near], '北江', true).spotlights[0].merchant.id).toBe('near');
    near.merchant.distanceKm = 7;
    expect(buildHomeRecommendations([far, near], '北江', true).spotlights[0].merchant.id).toBe('near');
    expect(buildHomeRecommendations([far], '北江', true).spotlights[0].merchant.id).toBe('far');
    expect(buildHomeRecommendations([unknown], '北江', true).spotlights[0].merchant.distanceKm).toBeNull();
  });

  it('prioritizes platform picks, then real rating, count, distance and stable ID', () => {
    const lower = candidate('1', 'COFFEE_TEA', { distanceKm: 1 }, { averageRating: 4.5, total: 50 });
    const best = candidate('2', 'COFFEE_TEA', { distanceKm: 2 }, { averageRating: 4.9, total: 8 });
    const tie = candidate('3', 'COFFEE_TEA', { distanceKm: 3 }, { averageRating: 4.9, total: 20 });
    const pick = candidate('4', 'COFFEE_TEA', { distanceKm: 4, promotionTags: [{ code: 'FEATURED' }] });
    expect(buildHomeRecommendations([lower, best, tie], '北江', true).spotlights[0]).toMatchObject({ merchant: { id: '3' }, reason: 'RATING', rating: { averageRating: 4.9, total: 20 } });
    expect(buildHomeRecommendations([pick, lower, best, tie], '北江', true).spotlights[0]).toMatchObject({ merchant: { id: '4' }, reason: 'FEATURED', rating: null });
    expect(buildHomeRecommendations([candidate('10'), candidate('2')], '北江', false).spotlights[0].merchant.id).toBe('2');
  });

  it.each([
    ['07:00', ['NOODLES', 'COFFEE']], ['10:00', ['COFFEE', 'MASSAGE']],
    ['12:00', ['FOOD', 'COFFEE']], ['15:00', ['COFFEE', 'MASSAGE']],
    ['18:00', ['FOOD', 'KTV']], ['00:00', ['KTV', 'FOOD']],
  ])('selects appropriate industries at %s', (time, kinds) => {
    const rows = ['CHINESE_RESTAURANT', 'NOODLE_SNACK', 'COFFEE_TEA', 'MASSAGE_SPA', 'KTV', 'HAIR_BEAUTY'].map((code, index) => candidate(String(index), code));
    expect(buildHomeRecommendations(rows, '北江', false, at(time)).scenes.map(item => item.kind)).toEqual(kinds);
  });

  it('does not infer breakfast from names or substitute unrelated retail/hair shops', () => {
    const rows = [candidate('restaurant'), candidate('retail', 'FLOWER_GIFT'), candidate('hair', 'HAIR_BEAUTY')];
    expect(buildHomeRecommendations(rows, '北江', false, at('07:00')).scenes).toEqual([]);
    expect(buildHomeRecommendations(rows.slice(1), '北江', false).spotlights).toEqual([]);
    rows[0].merchant.homepageCategoryKeys = ['noodles_snacks'];
    expect(buildHomeRecommendations(rows, '北江', false, at('07:00')).scenes[0].kind).toBe('NOODLES');
  });

  it('honors the existing platform manual recommendation flag as well as FEATURED tags', () => {
    const result = buildHomeRecommendations([candidate('1'), candidate('2', 'CHINESE_RESTAURANT', { manualPopular: true })], '北江', false, at('12:00'));
    expect(result.spotlights[0]).toMatchObject({ reason: 'FEATURED', merchant: { id: '2' } });
  });

  it('keeps cafes and cake shops out of meal recommendations even if they use the restaurant template', () => {
    const rows = [candidate('cake', 'CAKE', { contentTemplate: 'RESTAURANT', manualPopular: true }), candidate('cafe', 'COFFEE_TEA', { contentTemplate: 'RESTAURANT' }), candidate('meal')];
    const result = buildHomeRecommendations(rows, '北江', false, at('12:00'));
    expect(result.spotlights.find(item => item.kind === 'FOOD')?.merchant.id).toBe('meal');
    expect(result.scenes.find(item => item.kind === 'FOOD')?.merchant.id).toBe('meal');
  });

  it('uses another suitable open merchant for inspiration when possible', () => {
    expect(buildHomeRecommendations([candidate('1'), candidate('2')], '北江', false, at('12:00')).scenes[0].merchant.id).toBe('2');
  });

  it('fills missing KTV with another distinct open restaurant when cafes are closed', () => {
    const rows = [candidate('1'), candidate('2'), candidate('3'), candidate('cafe', 'COFFEE_TEA', { isOpen: false })];
    const result = buildHomeRecommendations(rows, '北江', false, at('22:00'));
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes.map(item => item.kind)).toEqual(['FOOD', 'FOOD']);
    expect(new Set(result.scenes.map(item => item.merchant.id)).size).toBe(2);
    expect(result.scenes[1].code).toBe('EVENING_FOOD_ALTERNATIVE');
    expect(result.scenes[1].titleZh).not.toBe(result.scenes[0].titleZh);
  });

  it('prefers open coffee over a second meal when KTV is unavailable at dinner', () => {
    const result = buildHomeRecommendations([candidate('1'), candidate('2'), candidate('coffee', 'COFFEE_TEA')], '北江', false, at('18:00'));
    expect(result.scenes.map(item => item.kind)).toEqual(['FOOD', 'COFFEE']);
    expect(result.scenes[1].titleZh).not.toContain('唱');
  });

  it('fills missing massage with another cafe and does not repeat a merchant', () => {
    const result = buildHomeRecommendations([candidate('coffee1', 'COFFEE_TEA'), candidate('coffee2', 'COFFEE_TEA')], '北江', false, at('15:00'));
    expect(result.scenes.map(item => item.kind)).toEqual(['COFFEE', 'COFFEE']);
    expect(new Set(result.scenes.map(item => item.merchant.id)).size).toBe(2);
    expect(result.scenes[1].titleZh).not.toContain('按摩');
  });

  it('retains one card when the only alternatives are closed, imageless, unrelated or in another city', () => {
    const rows = [candidate('one'), candidate('closed', 'CHINESE_RESTAURANT', { isOpen: false }), candidate('otherCity', 'CHINESE_RESTAURANT', { province: '北宁' }), candidate('noPhoto', 'CHINESE_RESTAURANT', { coverUrl: null }), candidate('hair', 'HAIR_BEAUTY')];
    expect(buildHomeRecommendations(rows, '北江', false, at('22:00')).scenes.map(item => item.merchant.id)).toEqual(['one']);
  });

  it('expands the second nearby slot after excluding the first scene merchant', () => {
    const rows = [candidate('near', 'CHINESE_RESTAURANT', { distanceKm: 2 }), candidate('next', 'CHINESE_RESTAURANT', { distanceKm: 7 })];
    expect(buildHomeRecommendations(rows, '北江', true, at('22:00')).scenes.map(item => item.merchant.id)).toEqual(['near', 'next']);
  });

  it('never uses hidden photos, menu/licence documents, or imageless cards', () => {
    const item = candidate('1', 'CHINESE_RESTAURANT', { coverUrl: null, images: [{ imageType: 'MENU', imageUrl: '/menu' }, { imageType: 'LICENSE', imageUrl: '/license' }, { imageType: 'PRODUCT', imageUrl: '/hidden', isVisible: false }] });
    expect(recommendationPhotos(item.merchant)).toEqual([]);
    expect(buildHomeRecommendations([item], '北江', false).spotlights).toEqual([]);
  });

  it('refreshes at a period boundary or within five minutes, including overnight', () => {
    expect(buildHomeRecommendations([], '北江', false, at('13:59')).refreshAfterSeconds).toBe(60);
    expect(buildHomeRecommendations([], '北江', false, at('00:01')).refreshAfterSeconds).toBe(300);
  });
});
