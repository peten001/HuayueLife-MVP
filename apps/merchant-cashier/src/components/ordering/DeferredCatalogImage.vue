<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  src: string;
  alt?: string;
}>();

const image = ref<HTMLImageElement | null>(null);
const resolvedSrc = ref('');
const failed = ref(false);
let observer: IntersectionObserver | null = null;

function prepare() {
  observer?.disconnect();
  observer = null;
  resolvedSrc.value = '';
  failed.value = false;
  if (!props.src || !image.value) return;
  if (typeof IntersectionObserver === 'undefined') {
    resolvedSrc.value = props.src;
    return;
  }
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    resolvedSrc.value = props.src;
    observer?.disconnect();
    observer = null;
  }, {
    root: image.value.closest('.table-ordering-products__scroller'),
    rootMargin: '100% 0px',
  });
  observer.observe(image.value);
}

watch(() => props.src, () => void nextTick(prepare));
onMounted(prepare);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <img
    ref="image"
    :src="resolvedSrc || undefined"
    :alt="alt || ''"
    loading="lazy"
    decoding="async"
    fetchpriority="low"
    :hidden="failed"
    @error="failed = true"
  />
</template>
