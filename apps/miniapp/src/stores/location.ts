import { defineStore } from 'pinia';

export type CityCode = 'Bac Giang' | 'Bac Ninh';
export type CitySource = 'GPS' | 'DEFAULT' | 'MANUAL';
export type LocationStatus =
  | 'IDLE'
  | 'LOCATING'
  | 'LOCATED_SUPPORTED'
  | 'LOCATED_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'FAILED';

export type LocationSnapshot = {
  city: CityCode;
  detectedCity: CityCode | null;
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
    city: 'Bac Giang' as CityCode,
    detectedCity: null as CityCode | null,
    source: 'DEFAULT' as CitySource,
    status: 'IDLE' as LocationStatus,
    latitude: null as number | null,
    longitude: null as number | null,
    bootstrapped: false,
    loading: false,
  }),
  getters: {
    currentProvince(state): CityCode | null {
      if (state.source === 'MANUAL') return state.city;
      return state.detectedCity;
    },
  },
  actions: {
    async bootstrapCity(force = false) {
      if (this.loading) return this.city;
      if (this.bootstrapped && !force) return this.city;
      const snapshot = await this.resolveLocation(force);
      return snapshot.city;
    },
    setCity(city: CityCode) {
      this.city = city;
      this.source = 'MANUAL';
      this.bootstrapped = true;
    },
    async relocate() {
      return this.resolveLocation(true);
    },
    async resolveLocation(force = false): Promise<LocationSnapshot> {
      if (this.loading) {
        return this.snapshot();
      }
      if (this.bootstrapped && !force) {
        return this.snapshot();
      }

      this.loading = true;
      this.status = 'LOCATING';
      try {
        try {
          const position = await new Promise<UniApp.GetLocationSuccess>((resolve, reject) => {
            uni.getLocation({
              type: 'wgs84',
              success: resolve,
              fail: reject,
            });
          });

          this.latitude = position.latitude;
          this.longitude = position.longitude;
          this.detectedCity = guessCityByLocation(position.latitude, position.longitude);
          this.status = this.detectedCity
            ? 'LOCATED_SUPPORTED'
            : 'LOCATED_UNSUPPORTED';

          if (this.source !== 'MANUAL') {
            if (this.detectedCity) {
              this.city = this.detectedCity;
              this.source = 'GPS';
            } else {
              this.city = 'Bac Giang';
              this.source = 'DEFAULT';
            }
          }
        } catch (error) {
          this.latitude = null;
          this.longitude = null;
          this.detectedCity = null;
          this.status = isPermissionDeniedError(error)
            ? 'PERMISSION_DENIED'
            : 'FAILED';
          if (this.source !== 'MANUAL') {
            this.city = 'Bac Giang';
            this.source = 'DEFAULT';
          }
        }

        this.bootstrapped = true;
        return this.snapshot();
      } finally {
        this.loading = false;
      }
    },
    snapshot(): LocationSnapshot {
      return {
        city: this.city,
        detectedCity: this.detectedCity,
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
