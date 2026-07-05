import { defineStore } from 'pinia';

/**
 * NOTE:
 * Bac Giang / Bac Ninh are BUSINESS REGIONS, not administrative provinces.
 * This system does NOT use real-world administrative boundaries.
 * GPS is only used to map user location into operational regions.
 */
export type OperationalRegionCode = 'Bac Giang' | 'Bac Ninh';
export type RegionCode = OperationalRegionCode;
export type CityCode = OperationalRegionCode;
export type CitySource = 'GPS' | 'MANUAL' | 'NONE';
export type LocationStatus =
  | 'IDLE'
  | 'LOCATING'
  | 'LOCATED_SUPPORTED'
  | 'LOCATED_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'FAILED';

export type LocationSnapshot = {
  operationalRegion: OperationalRegionCode | null;
  latitude: number | null;
  longitude: number | null;
  status: LocationStatus;
  source: CitySource;
};

type BoundaryBox = {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
};

const BAC_GIANG_BOUNDARY: BoundaryBox = {
  minLatitude: 21.07,
  maxLatitude: 21.43,
  minLongitude: 106.02,
  maxLongitude: 106.38,
};

const BAC_NINH_BOUNDARY: BoundaryBox = {
  minLatitude: 20.98,
  maxLatitude: 21.24,
  minLongitude: 105.92,
  maxLongitude: 106.22,
};

const BAC_GIANG_CENTER = { latitude: 21.281, longitude: 106.197 };
const BAC_NINH_CENTER = { latitude: 21.121, longitude: 106.084 };

export function guessCityByLocation(
  latitude: number,
  longitude: number,
): CityCode | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  // Current MVP only supports Bac Giang and Bac Ninh.
  // This uses approximate province boundary boxes and should be replaced
  // with administrative-area recognition if the app expands beyond them.
  const inBacGiang = isWithinBoundary(latitude, longitude, BAC_GIANG_BOUNDARY);
  const inBacNinh = isWithinBoundary(latitude, longitude, BAC_NINH_BOUNDARY);

  if (inBacGiang && !inBacNinh) return 'Bac Giang';
  if (inBacNinh && !inBacGiang) return 'Bac Ninh';
  if (!inBacGiang && !inBacNinh) return null;

  return distanceToCenter(latitude, longitude, BAC_GIANG_CENTER)
    <= distanceToCenter(latitude, longitude, BAC_NINH_CENTER)
    ? 'Bac Giang'
    : 'Bac Ninh';
}

export const useLocationStore = defineStore('location', {
  state: () => ({
    operationalRegion: null as OperationalRegionCode | null,
    source: 'NONE' as CitySource,
    status: 'IDLE' as LocationStatus,
    latitude: null as number | null,
    longitude: null as number | null,
    bootstrapped: false,
    loading: false,
  }),
  getters: {
    currentOperationalRegion(state): OperationalRegionCode | null {
      return state.operationalRegion;
    },
    // Legacy read-only alias for existing UI text rendering.
    city(state): CityCode | null {
      return state.operationalRegion;
    },
  },
  actions: {
    setCity(city: CityCode) {
      this.operationalRegion = city;
      this.source = 'MANUAL';
      this.bootstrapped = true;
    },
    async relocate() {
      return this.captureLocation(false);
    },
    async resolveLocation(force = false): Promise<LocationSnapshot> {
      if (this.loading) {
        return this.snapshot();
      }
      if (this.bootstrapped && !force) {
        return this.snapshot();
      }

      return this.captureLocation(true);
    },
    async captureLocation(persist: boolean): Promise<LocationSnapshot> {

      this.loading = true;
      try {
        let latitude: number | null = null;
        let longitude: number | null = null;
        let operationalRegion: OperationalRegionCode | null = null;
        let status: LocationStatus = 'LOCATING';

        if (persist) {
          this.status = 'LOCATING';
        }

        try {
          const position = await new Promise<UniApp.GetLocationSuccess>((resolve, reject) => {
            uni.getLocation({
              type: 'wgs84',
              success: resolve,
              fail: reject,
            });
          });

          latitude = position.latitude;
          longitude = position.longitude;
          operationalRegion = guessCityByLocation(position.latitude, position.longitude);
          status = operationalRegion
            ? 'LOCATED_SUPPORTED'
            : 'LOCATED_UNSUPPORTED';
          if (persist) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.status = status;
            this.operationalRegion = operationalRegion;
            this.source = operationalRegion ? 'GPS' : 'NONE';
          }
        } catch (error) {
          latitude = null;
          longitude = null;
          operationalRegion = null;
          status = isPermissionDeniedError(error)
            ? 'PERMISSION_DENIED'
            : 'FAILED';
          if (persist) {
            this.latitude = null;
            this.longitude = null;
            this.status = status;
            this.operationalRegion = null;
            this.source = 'NONE';
          }
        }

        if (persist) {
          this.bootstrapped = true;
          return this.snapshot();
        }

        return {
          operationalRegion: status === 'LOCATED_SUPPORTED'
            ? operationalRegion
            : null,
          latitude,
          longitude,
          status,
          source: status === 'LOCATED_SUPPORTED' ? 'GPS' : 'NONE',
        };
      } finally {
        this.loading = false;
      }
    },
    snapshot(): LocationSnapshot {
      return {
        operationalRegion: this.operationalRegion,
        latitude: this.latitude,
        longitude: this.longitude,
        status: this.status,
        source: this.source,
      };
    },
  },
});

function isWithinBoundary(
  latitude: number,
  longitude: number,
  boundary: BoundaryBox,
) {
  return latitude >= boundary.minLatitude
    && latitude <= boundary.maxLatitude
    && longitude >= boundary.minLongitude
    && longitude <= boundary.maxLongitude;
}

function distanceToCenter(
  latitude: number,
  longitude: number,
  center: { latitude: number; longitude: number },
) {
  const latitudeDelta = latitude - center.latitude;
  const longitudeDelta = longitude - center.longitude;
  return latitudeDelta ** 2 + longitudeDelta ** 2;
}

function isPermissionDeniedError(error: unknown) {
  const text = String(
    (error as { errMsg?: string; message?: string } | null)?.errMsg
    ?? (error as { message?: string } | null)?.message
    ?? '',
  ).toLowerCase();

  return text.includes('auth deny')
    || text.includes('auth denied')
    || text.includes('permission denied')
    || text.includes('authorize no response')
    || text.includes('privacy permission');
}
