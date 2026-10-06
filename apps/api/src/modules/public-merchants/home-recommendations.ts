import { BUSINESS_TIME_ZONE, BUSINESS_TIME_ZONE_OFFSET_MINUTES } from '../../common/utils/merchant-hours';

export type RecommendationKind = 'FOOD' | 'COFFEE' | 'NOODLES' | 'MASSAGE' | 'KTV';
export type RecommendationRating = { averageRating: number; total: number };
export type RecommendationMerchant = {
  id: string | bigint;
  province: string;
  businessType?: { code: string } | null;
  contentTemplate?: string;
  homepageCategoryKeys: string[];
  isOpen: boolean;
  distanceKm: number | null;
  promotionTags: Array<{ code: string }>;
  manualPopular?: boolean;
  coverUrl?: string | null;
  logoUrl?: string | null;
  images: Array<{ imageType: string; imageUrl: string; isVisible?: boolean }>;
  signatureDishes: Array<{ imageUrl: string }>;
};
export type RecommendationCandidate<T extends RecommendationMerchant = RecommendationMerchant> = {
  merchant: T;
  rating: RecommendationRating | null;
};

const FOOD_TYPES = ['FOOD_SERVICE', 'CHINESE_RESTAURANT', 'NOODLE_SNACK', 'VIETNAMESE_FOOD', 'RESTAURANT'];
const PERIODS = [
  { code: 'BREAKFAST', start: 5, end: 9, label: ['早餐时间', 'Giờ ăn sáng', 'Breakfast time'], scenes: ['NOODLES', 'COFFEE'] },
  { code: 'MORNING', start: 9, end: 11, label: ['上午小憩', 'Thư giãn buổi sáng', 'Morning break'], scenes: ['COFFEE', 'MASSAGE'] },
  { code: 'LUNCH', start: 11, end: 14, label: ['午餐时间', 'Giờ ăn trưa', 'Lunch time'], scenes: ['FOOD', 'COFFEE'] },
  { code: 'AFTERNOON', start: 14, end: 17, label: ['午后时光', 'Buổi chiều thư thái', 'Afternoon break'], scenes: ['COFFEE', 'MASSAGE'] },
  { code: 'DINNER', start: 17, end: 21, label: ['晚餐时间', 'Giờ ăn tối', 'Dinner time'], scenes: ['FOOD', 'KTV'] },
  { code: 'EVENING', start: 21, end: 29, label: ['夜晚好去处', 'Điểm đến buổi tối', 'Evening outings'], scenes: ['KTV', 'FOOD'] },
] as const;

/** Server time governs Vietnam schedules, independently of the device timezone. */
export function recommendationPeriod(at: Date) {
  const local = new Date(at.getTime() + BUSINESS_TIME_ZONE_OFFSET_MINUTES * 60_000);
  const hour = local.getUTCHours();
  const period = PERIODS.find(item => (hour < 5 ? hour + 24 : hour) >= item.start && (hour < 5 ? hour + 24 : hour) < item.end)!;
  const nextBoundary = new Date(local);
  nextBoundary.setUTCHours(period.end, 0, 0, 0);
  // The overnight slot ends at 05:00 of this local date when it is before dawn.
  if (hour < 5) nextBoundary.setUTCDate(nextBoundary.getUTCDate() - 1);
  return { ...period, endsAt: new Date(nextBoundary.getTime() - BUSINESS_TIME_ZONE_OFFSET_MINUTES * 60_000).toISOString() };
}

export function recommendationPhotos(merchant: RecommendationMerchant) {
  const images = merchant.images.filter(item => item.isVisible !== false);
  const store = [merchant.coverUrl, ...images.filter(item => ['COVER', 'STORE', 'ENVIRONMENT'].includes(item.imageType)).map(item => item.imageUrl)];
  const products = images.filter(item => item.imageType === 'PRODUCT').map(item => item.imageUrl);
  const photos = [
    ...(merchant.businessType?.code === 'COFFEE_TEA' ? [...store, ...products] : [...merchant.signatureDishes.map(item => item.imageUrl), ...products, ...store]),
    merchant.logoUrl,
  ];
  return [...new Set(photos.filter((url): url is string => Boolean(url?.trim())))];
}

function matchesKind(merchant: RecommendationMerchant, kind: RecommendationKind) {
  const code = merchant.businessType?.code || '';
  if (kind === 'COFFEE') return code === 'COFFEE_TEA';
  if (kind === 'MASSAGE') return code === 'MASSAGE_SPA';
  if (kind === 'KTV') return code === 'KTV';
  // Explicit industry/classification only; names never infer cuisine or services.
  const food = !['COFFEE_TEA', 'CAKE'].includes(code) && (FOOD_TYPES.includes(code) || merchant.contentTemplate === 'RESTAURANT');
  if (kind === 'NOODLES') return food && (code === 'NOODLE_SNACK' || merchant.homepageCategoryKeys.includes('noodles_snacks'));
  return food;
}

function featured(candidate: RecommendationCandidate) {
  return Boolean(candidate.merchant.manualPopular) || candidate.merchant.promotionTags.some(tag => tag.code === 'FEATURED');
}

/** Open shops first; the nearest available 5/10 km pool precedes distant shops. */
function ranked<T extends RecommendationMerchant>(candidates: RecommendationCandidate<T>[], kind: RecommendationKind, gps: boolean, openOnly: boolean) {
  let pool = candidates.filter(item => matchesKind(item.merchant, kind) && recommendationPhotos(item.merchant).length && (!openOnly || item.merchant.isOpen));
  const open = pool.filter(item => item.merchant.isOpen);
  if (open.length) pool = open;
  if (gps) {
    const located = pool.filter(item => item.merchant.distanceKm !== null);
    const within = (km: number) => located.filter(item => item.merchant.distanceKm! <= km);
    pool = within(5).length ? within(5) : within(10).length ? within(10) : located.length ? located : pool;
  }
  return pool.sort((a, b) => Number(featured(b)) - Number(featured(a))
    || (b.rating?.averageRating ?? 0) - (a.rating?.averageRating ?? 0)
    || (b.rating?.total ?? 0) - (a.rating?.total ?? 0)
    || (a.merchant.distanceKm ?? Infinity) - (b.merchant.distanceKm ?? Infinity)
    || String(a.merchant.id).localeCompare(String(b.merchant.id), 'en', { numeric: true }));
}

function entry<T extends RecommendationMerchant>(candidate: RecommendationCandidate<T>, kind: RecommendationKind, gps: boolean) {
  return {
    kind,
    merchant: candidate.merchant,
    photos: recommendationPhotos(candidate.merchant),
    rating: candidate.rating ? { ...candidate.rating, averageRating: Number(candidate.rating.averageRating.toFixed(1)) } : null,
    reason: featured(candidate) ? 'FEATURED' as const : candidate.rating ? 'RATING' as const : gps && candidate.merchant.distanceKm !== null ? 'NEARBY' as const : 'CITY' as const,
  };
}

function sceneCopy(kind: RecommendationKind, period: string) {
  if (kind === 'NOODLES') return { titleZh: '早起，吃碗热粉面', titleVi: 'Bắt đầu ngày với tô bún nóng', titleEn: 'Start with a warm bowl', subtitleZh: '热乎的一餐，开启新一天', subtitleVi: 'Bữa sáng ấm áp cho ngày mới', subtitleEn: 'A warm breakfast to start the day' };
  if (kind === 'COFFEE') return { titleZh: period === 'AFTERNOON' ? '午后，喝杯咖啡' : '一杯咖啡，慢下来', titleVi: 'Thảnh thơi bên ly cà phê', titleEn: 'Slow down over coffee', subtitleZh: '找个舒服的角落，坐一会儿', subtitleVi: 'Tìm một góc thoải mái để nghỉ ngơi', subtitleEn: 'Find a cosy corner for a break' };
  if (kind === 'MASSAGE') return { titleZh: '放松一下，缓缓疲惫', titleVi: 'Thư giãn, xua tan mệt mỏi', titleEn: 'Relax and recharge', subtitleZh: '按摩足疗，给自己一点休息时间', subtitleVi: 'Massage và chăm sóc chân, nghỉ ngơi một chút', subtitleEn: 'Take a little time for a massage' };
  if (kind === 'KTV') return { titleZh: '约上朋友，唱一场', titleVi: 'Hẹn bạn bè đi hát', titleEn: 'Sing with your friends', subtitleZh: '唱歌小聚，给夜晚加点乐趣', subtitleVi: 'Cùng hát để buổi tối thêm vui', subtitleEn: 'Make an evening of it together' };
  return period === 'LUNCH'
    ? { titleZh: '午餐，认真吃顿好的', titleVi: 'Ăn một bữa trưa thật ngon', titleEn: 'Make time for a good lunch', subtitleZh: '选家好店，给午休添点滋味', subtitleVi: 'Chọn quán ngon cho giờ nghỉ trưa', subtitleEn: 'A tasty stop for your lunch break' }
    : { titleZh: period === 'DINNER' ? '晚餐，约一顿好吃的' : '夜晚，找点好吃的', titleVi: 'Hẹn một bữa ăn ngon', titleEn: 'Meet over a good meal', subtitleZh: '看看招牌菜，选好聚餐的地方', subtitleVi: 'Xem món đặc trưng, chọn nơi gặp gỡ', subtitleEn: 'Find a signature dish to share' };
}

function alternativeSceneCopy(kind: RecommendationKind) {
  if (kind === 'COFFEE') return { titleZh: '换个角落，喝杯咖啡', titleVi: 'Đổi góc quen, thưởng thức cà phê', titleEn: 'Try another coffee spot', subtitleZh: '看看另一家店，找个喜欢的角落', subtitleVi: 'Khám phá một quán khác và góc bạn thích', subtitleEn: 'Find another cosy corner you like' };
  if (kind === 'NOODLES') return { titleZh: '再找一碗合口味的', titleVi: 'Tìm thêm một tô hợp khẩu vị', titleEn: 'Find another breakfast bowl', subtitleZh: '逛逛粉面小店，看看店里的菜单', subtitleVi: 'Ghé quán bún phở khác và xem thực đơn', subtitleEn: 'Browse another noodle shop and its menu' };
  if (kind === 'MASSAGE') return { titleZh: '找家店，放松一下', titleVi: 'Tìm một nơi khác để thư giãn', titleEn: 'Another place to unwind', subtitleZh: '看看门店环境和服务项目', subtitleVi: 'Xem không gian và các dịch vụ', subtitleEn: 'Explore the space and available services' };
  if (kind === 'KTV') return { titleZh: '换个地方，一起唱', titleVi: 'Thử một nơi hát khác cùng bạn bè', titleEn: 'Try another place to sing', subtitleZh: '看看包厢环境，约上朋友小聚', subtitleVi: 'Xem phòng hát và hẹn bạn bè', subtitleEn: 'Explore the rooms for your next get-together' };
  return { titleZh: '换家店，尝点新口味', titleVi: 'Đổi quán, thử hương vị mới', titleEn: 'Try a different place to eat', subtitleZh: '看看菜单和环境，找家合口味的店', subtitleVi: 'Xem thực đơn và không gian, tìm quán hợp khẩu vị', subtitleEn: 'Browse the menu and space for your next meal' };
}

export function buildHomeRecommendations<T extends RecommendationMerchant>(candidates: RecommendationCandidate<T>[], region: string | null, gps: boolean, at = new Date()) {
  const period = recommendationPeriod(at);
  const regional = region ? candidates.filter(item => item.merchant.province === region) : [];
  const spotlights = (['FOOD', 'COFFEE'] as const).flatMap(kind => {
    const chosen = ranked(regional, kind, gps, false)[0];
    return chosen ? [entry(chosen, kind, gps)] : [];
  });
  const used = new Set(spotlights.map(item => String(item.merchant.id)));
  const scenes = period.scenes.flatMap(kind => {
    const pool = ranked(regional, kind, gps, true);
    const chosen = pool.find(item => !used.has(String(item.merchant.id))) ?? pool[0];
    if (!chosen) return [];
    used.add(String(chosen.merchant.id));
    return [{ code: `${period.code}_${kind}`, ...sceneCopy(kind, period.code), ...entry(chosen, kind, gps) }];
  });
  // A city may not yet have a KTV or massage listing. Fill a second slot with
  // another real, open shop appropriate for this period, never a pretend service.
  const sceneMerchants = new Set(scenes.map(item => String(item.merchant.id)));
  const fallbackKinds: readonly RecommendationKind[] = period.code === 'DINNER' || period.code === 'EVENING'
    ? ['COFFEE', 'FOOD', 'KTV'] : period.scenes;
  for (const kind of fallbackKinds) {
    if (scenes.length >= 2) break;
    const pool = ranked(regional.filter(item => !sceneMerchants.has(String(item.merchant.id))), kind, gps, true);
    const chosen = pool.find(item => !used.has(String(item.merchant.id))) ?? pool[0];
    if (!chosen) continue;
    const sameKind = scenes.some(item => item.kind === kind);
    scenes.push({ code: `${period.code}_${kind}_ALTERNATIVE`, ...(sameKind ? alternativeSceneCopy(kind) : sceneCopy(kind, period.code)), ...entry(chosen, kind, gps) });
    sceneMerchants.add(String(chosen.merchant.id));
    used.add(String(chosen.merchant.id));
  }
  return {
    region, locationMode: !region ? 'REGION_REQUIRED' as const : gps ? 'GPS' as const : 'CITY' as const,
    timeZone: BUSINESS_TIME_ZONE, generatedAt: at.toISOString(),
    // Refresh within five minutes for changes in opening hours, reviews and availability.
    refreshAfterSeconds: Math.max(1, Math.min(300, Math.ceil((Date.parse(period.endsAt) - at.getTime()) / 1000))),
    period: { code: period.code, nameZh: period.label[0], nameVi: period.label[1], nameEn: period.label[2], endsAt: period.endsAt },
    spotlights, scenes,
  };
}
