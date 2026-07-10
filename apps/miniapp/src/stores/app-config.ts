import { defineStore } from 'pinia';
import { getAppConfig } from '@/api/catalog';

let pendingLoad: Promise<void> | null = null;

export const useAppConfigStore = defineStore('appConfig', {
  state: () => ({
    platformOrderingEnabled: false,
    ready: false,
    loading: false,
  }),
  actions: {
    async load() {
      if (pendingLoad) return pendingLoad;
      this.loading = true;
      pendingLoad = (async () => {
        try {
          const config = await getAppConfig();
          this.platformOrderingEnabled = Boolean(config.platformOrderingEnabled);
        } catch (error) {
          console.warn('[app-config] load failed, ordering disabled by default', error);
          this.platformOrderingEnabled = false;
        } finally {
          this.ready = true;
          this.loading = false;
          pendingLoad = null;
        }
      })();
      return pendingLoad;
    },
    async ensureLoaded() {
      if (this.ready) return;
      await this.load();
    },
  },
});
