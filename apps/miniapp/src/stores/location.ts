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
export type LocationSource = 'GPS' | 'MANUAL' | 'CACHE' | 'NONE';
export type CitySource = LocationSource;
export type LocationStatus =
  | 'IDLE'
  | 'LOCATING'
  | 'LOCATED_SUPPORTED'
  | 'LOCATED_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'FAILED';

export type LocationSnapshot = {
  operationalRegion: OperationalRegionCode | null;
  browseProvince: OperationalRegionCode | null;
  locatedProvince: OperationalRegionCode | null;
  locatedCityName: string | null;
  latitude: number | null;
  longitude: number | null;
  status: LocationStatus;
  locationStatus: LocationStatus;
  source: LocationSource;
};

type StoredLocationState = {
  version?: number;
  operationalRegion?: OperationalRegionCode | null;
  browseProvince?: OperationalRegionCode | null;
  locatedProvince?: OperationalRegionCode | null;
  locatedCityName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: LocationSource;
  status?: LocationStatus;
  locationStatus?: LocationStatus;
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
const LOCATION_STATE_KEY = 'miniapp.location-state.v1';
let pendingLocationRequest: Promise<LocationSnapshot> | null = null;

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
    browseProvince: null as OperationalRegionCode | null,
    locatedProvince: null as OperationalRegionCode | null,
    locatedCityName: null as string | null,
    source: 'NONE' as LocationSource,
    status: 'IDLE' as LocationStatus,
    locationStatus: 'IDLE' as LocationStatus,
    latitude: null as number | null,
    longitude: null as number | null,
    bootstrapped: false,
    loading: false,
    hydrated: false,
  }),
  getters: {
    currentOperationalRegion(state): OperationalRegionCode | null {
      return state.browseProvince ?? state.locatedProvince ?? state.operationalRegion;
    },
    // Legacy read-only alias for existing UI text rendering.
    city(state): CityCode | null {
      return state.browseProvince ?? state.locatedProvince ?? state.operationalRegion;
    },
  },
  actions: {
    hydrateFromStorage() {
      if (this.hydrated) return;
      this.hydrated = true;

      try {
        const stored = uni.getStorageSync(LOCATION_STATE_KEY) as StoredLocationState | null;
        if (!stored || typeof stored !== 'object') return;

        const hasV2Fields = 'browseProvince' in stored || 'locatedProvince' in stored;
        const legacyOperationalRegion = isOperationalRegionCode(stored.operationalRegion)
          ? stored.operationalRegion
          : null;
        const source = isCitySource(stored.source)
          ? stored.source
          : 'NONE';
        const storedBrowseProvince = isOperationalRegionCode(stored.browseProvince)
          ? stored.browseProvince
          : null;
        const storedLocatedProvince = isOperationalRegionCode(stored.locatedProvince)
          ? stored.locatedProvince
          : null;
        const browseProvince = hasV2Fields
          ? storedBrowseProvince
          : inferLegacyBrowseProvince(legacyOperationalRegion);
        const locatedProvince = hasV2Fields
          ? storedLocatedProvince
          : inferLegacyLocatedProvince(legacyOperationalRegion, source);
        const latitude = normalizeCoordinate(stored.latitude);
        const longitude = normalizeCoordinate(stored.longitude);
        const locationStatus = normalizeLocationStatus(stored.locationStatus ?? stored.status)
          ?? inferLocationStatus(locatedProvince);

        this.browseProvince = browseProvince;
        this.locatedProvince = locatedProvince;
        this.locatedCityName = normalizeLocatedCityName(stored.locatedCityName);
        this.latitude = latitude;
        this.longitude = longitude;
        this.locationStatus = locationStatus;
        this.status = locationStatus;
        this.source = locationStatus === 'LOCATED_UNSUPPORTED' && source === 'GPS'
          ? 'GPS'
          : resolveHydratedSource(source, browseProvince, locatedProvince);
        this.syncOperationalRegion();
        this.bootstrapped = Boolean(
          browseProvince
          || locatedProvince
          || this.locatedCityName
          || locationStatus !== 'IDLE',
        );
      } catch {
        // Ignore malformed local cache and fall back to runtime state.
      }
    },
    persistState() {
      const next: StoredLocationState = {
        version: 2,
        operationalRegion: this.resolveDisplayProvince(),
        browseProvince: this.browseProvince,
        locatedProvince: this.locatedProvince,
        locatedCityName: this.locatedCityName,
        latitude: normalizeCoordinate(this.latitude),
        longitude: normalizeCoordinate(this.longitude),
        source: this.resolvePersistedSource(),
        status: this.locationStatus,
        locationStatus: this.locationStatus,
      };

      if (!hasPersistableState(next)) {
        uni.removeStorageSync(LOCATION_STATE_KEY);
        return;
      }

      uni.setStorageSync(LOCATION_STATE_KEY, next);
    },
    setBrowseProvince(regionCode: RegionCode) {
      this.hydrateFromStorage();
      this.browseProvince = regionCode;
      this.source = 'MANUAL';
      if (!this.locatedProvince && this.locationStatus === 'IDLE') {
        this.status = 'IDLE';
        this.locationStatus = 'IDLE';
      }
      this.bootstrapped = true;
      this.syncOperationalRegion();
      this.persistState();
    },
    setCity(city: CityCode) {
      this.setBrowseProvince(city);
    },
    clearManualOverride() {
      this.hydrateFromStorage();
      if (!this.browseProvince && this.source !== 'MANUAL') return;
      this.browseProvince = null;
      this.source = this.locatedProvince ? 'GPS' : 'NONE';
      this.syncOperationalRegion();
      this.bootstrapped = Boolean(this.locatedProvince || this.locationStatus !== 'IDLE');
      this.persistState();
    },
    async relocate() {
      return this.resolveLocation(true);
    },
    async refreshLocationForNearby(): Promise<LocationSnapshot> {
      this.hydrateFromStorage();
      if (pendingLocationRequest) {
        return pendingLocationRequest;
      }

      pendingLocationRequest = this.captureLocation({
        persist: true,
        updateBrowseFromGps: false,
      }).finally(() => {
        pendingLocationRequest = null;
      });

      return pendingLocationRequest;
    },
    async resolveLocation(force = false): Promise<LocationSnapshot> {
      this.hydrateFromStorage();
      if (pendingLocationRequest) {
        return pendingLocationRequest;
      }
      if (this.browseProvince && !force) {
        return this.snapshot();
      }
      if (this.locatedProvince && !force) {
        return this.snapshot();
      }

      pendingLocationRequest = this.captureLocation({
        persist: true,
        updateBrowseFromGps: !this.browseProvince,
      }).finally(() => {
        pendingLocationRequest = null;
      });

      return pendingLocationRequest;
    },
    async captureLocation(options: {
      persist: boolean;
      updateBrowseFromGps?: boolean;
    }): Promise<LocationSnapshot> {
      this.hydrateFromStorage();
      this.loading = true;
      try {
        let latitude: number | null = null;
        let longitude: number | null = null;
        let locatedProvince: OperationalRegionCode | null = null;
        let status: LocationStatus = 'LOCATING';

        if (options.persist) {
          this.status = 'LOCATING';
          this.locationStatus = 'LOCATING';
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
          locatedProvince = guessCityByLocation(position.latitude, position.longitude);
          status = locatedProvince
            ? 'LOCATED_SUPPORTED'
            : 'LOCATED_UNSUPPORTED';
          if (options.persist) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.status = status;
            this.locationStatus = status;
            this.source = 'GPS';
            if (locatedProvince) {
              this.locatedProvince = locatedProvince;
              this.locatedCityName = null;
              if (options.updateBrowseFromGps && !this.browseProvince) {
                this.browseProvince = locatedProvince;
              }
            } else {
              this.locatedProvince = null;
              this.locatedCityName = 'unsupported';
              this.source = 'GPS';
            }
            this.syncOperationalRegion();
          }
        } catch (error) {
          latitude = null;
          longitude = null;
          locatedProvince = null;
          status = isPermissionDeniedError(error)
            ? 'PERMISSION_DENIED'
            : 'FAILED';
          if (options.persist) {
            this.status = status;
            this.locationStatus = status;
            this.source = this.resolveFailureSource();
            this.syncOperationalRegion();
          }
        }

        if (options.persist) {
          this.bootstrapped = true;
          this.persistState();
          return this.snapshot();
        }

        return {
          operationalRegion: status === 'LOCATED_SUPPORTED'
            ? locatedProvince
            : null,
          browseProvince: this.browseProvince,
          locatedProvince: status === 'LOCATED_SUPPORTED' ? locatedProvince : null,
          locatedCityName: status === 'LOCATED_UNSUPPORTED' ? 'unsupported' : null,
          latitude,
          longitude,
          status,
          locationStatus: status,
          source: status === 'LOCATED_SUPPORTED' ? 'GPS' : 'NONE',
        };
      } finally {
        this.loading = false;
      }
    },
    snapshot(): LocationSnapshot {
      return {
        operationalRegion: this.resolveDisplayProvince(),
        browseProvince: this.browseProvince,
        locatedProvince: this.locatedProvince,
        locatedCityName: this.locatedCityName,
        latitude: this.latitude,
        longitude: this.longitude,
        status: this.locationStatus,
        locationStatus: this.locationStatus,
        source: this.source,
      };
    },
    resolveDisplayProvince(): OperationalRegionCode | null {
      return this.browseProvince ?? this.locatedProvince ?? null;
    },
    syncOperationalRegion() {
      this.operationalRegion = this.resolveDisplayProvince();
    },
    resolvePersistedSource(): LocationSource {
      if (this.source === 'MANUAL' && this.browseProvince) return 'MANUAL';
      if (this.source === 'GPS' && (this.locatedProvince || this.locationStatus === 'LOCATED_UNSUPPORTED')) return 'GPS';
      if (this.locatedProvince) return 'CACHE';
      if (this.browseProvince) return 'MANUAL';
      return 'NONE';
    },
    resolveFailureSource(): LocationSource {
      if (this.browseProvince) return 'MANUAL';
      if (this.locatedProvince) return 'CACHE';
      return 'NONE';
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

function isOperationalRegionCode(value: unknown): value is OperationalRegionCode {
  return value === 'Bac Giang' || value === 'Bac Ninh';
}

function isCitySource(value: unknown): value is LocationSource {
  return value === 'GPS' || value === 'MANUAL' || value === 'CACHE' || value === 'NONE';
}

function normalizeLocationStatus(value: unknown): LocationStatus | null {
  return isLocationStatus(value) ? value : null;
}

function isLocationStatus(value: unknown): value is LocationStatus {
  return value === 'IDLE'
    || value === 'LOCATING'
    || value === 'LOCATED_SUPPORTED'
    || value === 'LOCATED_UNSUPPORTED'
    || value === 'PERMISSION_DENIED'
    || value === 'FAILED';
}

function inferLocationStatus(
  locatedProvince: OperationalRegionCode | null,
): LocationStatus {
  return locatedProvince ? 'LOCATED_SUPPORTED' : 'IDLE';
}

function inferLegacyBrowseProvince(
  legacyOperationalRegion: OperationalRegionCode | null,
) {
  if (!legacyOperationalRegion) return null;
  return legacyOperationalRegion;
}

function inferLegacyLocatedProvince(
  legacyOperationalRegion: OperationalRegionCode | null,
  source: LocationSource,
) {
  if (!legacyOperationalRegion) return null;
  return source === 'GPS' || source === 'CACHE' ? legacyOperationalRegion : null;
}

function resolveHydratedSource(
  source: LocationSource,
  browseProvince: OperationalRegionCode | null,
  locatedProvince: OperationalRegionCode | null,
): LocationSource {
  if (source === 'MANUAL' && browseProvince) return 'MANUAL';
  if (source === 'GPS' && locatedProvince) return 'GPS';
  if (source === 'CACHE' && locatedProvince) return 'CACHE';
  if (browseProvince) return 'MANUAL';
  if (locatedProvince) return 'CACHE';
  return 'NONE';
}

function normalizeLocatedCityName(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function hasPersistableState(state: StoredLocationState) {
  return Boolean(
    state.browseProvince
    || state.locatedProvince
    || state.locatedCityName
    || normalizeCoordinate(state.latitude) !== null
    || normalizeCoordinate(state.longitude) !== null
    || (state.locationStatus && state.locationStatus !== 'IDLE')
    || (state.status && state.status !== 'IDLE'),
  );
}

function normalizeCoordinate(value: unknown) {
  return Number.isFinite(value) ? Number(value) : null;
}
