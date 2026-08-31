import { onBeforeUnmount, onMounted, ref } from 'vue';

export function useMediaQuery(query: string) {
  let media: MediaQueryList | null = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;
  const matches = ref(Boolean(media?.matches));
  const update = () => { matches.value = Boolean(media?.matches); };

  onMounted(() => {
    if (typeof window.matchMedia !== 'function') return;
    media ??= window.matchMedia(query);
    update();
    if (typeof media.addEventListener === 'function') media.addEventListener('change', update);
    else media.addListener(update);
  });
  onBeforeUnmount(() => {
    if (!media) return;
    if (typeof media.removeEventListener === 'function') media.removeEventListener('change', update);
    else media.removeListener(update);
  });
  return matches;
}
