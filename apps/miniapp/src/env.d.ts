/// <reference types="@dcloudio/types" />
/// <reference types="vite/client" />

declare module '*.vue';

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENABLE_MAP_APP_TEST?: string;
}
