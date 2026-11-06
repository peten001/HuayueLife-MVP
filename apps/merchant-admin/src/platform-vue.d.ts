import 'vue';
declare module 'vue' {
  interface ComponentCustomProperties {
    $pt: (text: string) => string;
  }
}
export {};
