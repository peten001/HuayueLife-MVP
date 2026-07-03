import { defineStore } from 'pinia';

export type CityCode = 'Bac Giang' | 'Bac Ninh';
export type CitySource = 'GPS' | 'DEFAULT' | 'MANUAL';

function guessCityByLocation(
  latitude: number,
  longitude: number,
): CityCode | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (longitude < 105.95 || longitude > 106.45) return null;
  if (latitude < 20.95 || latitude > 21.45) return null;
  if (latitude >= 21.2) return 'Bac Giang';
  if (latitude <= 21.18) return 'Bac Ninh';
  if (longitude >= 106.08) return 'Bac Giang';
  return 'Bac Ninh';
}

export const useLocationStore = defineStore('location', {
  state: () => ({
    city: 'Bac Giang' as CityCode,
    detectedCity: null as CityCode | null,
    source: 'DEFAULT' as CitySource,
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
      this.loading = true;
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
          if (this.source !== 'MANUAL') {
            if (this.detectedCity) {
              this.city = this.detectedCity;
              this.source = 'GPS';
            } else {
              this.city = 'Bac Giang';
              this.source = 'DEFAULT';
            }
          }
        } catch {
          this.latitude = null;
          this.longitude = null;
          this.detectedCity = null;
          if (this.source !== 'MANUAL') {
            this.city = 'Bac Giang';
            this.source = 'DEFAULT';
          }
        }
        this.bootstrapped = true;
        return this.city;
      } finally {
        this.loading = false;
      }
    },
    setCity(city: CityCode) {
      this.city = city;
      this.source = 'MANUAL';
      this.bootstrapped = true;
    },
    async relocate() {
      return this.bootstrapCity(true);
    },
  },
});
