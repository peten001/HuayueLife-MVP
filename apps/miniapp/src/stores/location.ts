import { defineStore } from 'pinia';

export type CityCode = 'Bac Giang' | 'Bac Ninh';
export type CitySource = 'GPS' | 'DEFAULT' | 'MANUAL';

function guessCityByLocation(latitude: number, longitude: number): CityCode {
  if (latitude >= 21.2) return 'Bac Giang';
  if (latitude <= 21.18) return 'Bac Ninh';
  if (longitude >= 106.08) return 'Bac Giang';
  return 'Bac Ninh';
}

export const useLocationStore = defineStore('location', {
  state: () => ({
    city: 'Bac Giang' as CityCode,
    source: 'DEFAULT' as CitySource,
    bootstrapped: false,
    loading: false,
  }),
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
          this.city = guessCityByLocation(position.latitude, position.longitude);
          this.source = 'GPS';
        } catch {
          this.city = 'Bac Giang';
          this.source = 'DEFAULT';
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
