import type { HomeRecommendations } from '@/types/api';

export type RecommendationContext = { province: '北江' | '北宁'; lat?: number; lng?: number };

/** Never reuse GPS for a city the user selected elsewhere. */
export function homeRecommendationContext(region: string | null | undefined, locatedRegion: string | null | undefined, latitude?: number | null, longitude?: number | null): RecommendationContext | null {
  if (region !== 'Bac Giang' && region !== 'Bac Ninh') return null;
  const context: RecommendationContext = { province: region === 'Bac Ninh' ? '北宁' : '北江' };
  if (locatedRegion === region && latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    context.lat = Number(latitude.toFixed(7));
    context.lng = Number(longitude.toFixed(7));
  }
  return context;
}

export function recommendationRefreshDelay(data: Pick<HomeRecommendations, 'refreshAfterSeconds'>) {
  // Server supplies a relative lifetime, avoiding device timezone/clock drift.
  return Math.max(1000, Math.min(300_000, data.refreshAfterSeconds * 1000));
}

export function recommendationResponseIsCurrent(responseSequence: number, currentSequence: number, responseKey: string, currentKey: string, visible: boolean) {
  return visible && responseSequence === currentSequence && responseKey === currentKey;
}
