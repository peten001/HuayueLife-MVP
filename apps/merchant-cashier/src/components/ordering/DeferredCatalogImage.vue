<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { observeCatalogImage, type CatalogImageLoadReason } from './catalog-image-visibility';

const props = defineProps<{
  src: string;
  alt?: string;
  eager?: boolean;
}>();

const image = ref<HTMLImageElement | null>(null);
const resolvedSrc = ref('');
const failed = ref(false);
const loadReason = ref<CatalogImageLoadReason | ''>('');
let stopObserving: (() => void) | null = null;

function prepare() {
  stopObserving?.();
  stopObserving = null;
  resolvedSrc.value = '';
  failed.value = false;
  loadReason.value = '';
  if (!props.src || !image.value) return;
  if (props.eager) {
    resolvedSrc.value = props.src;
    loadReason.value = 'initial';
    return;
  }
  stopObserving = observeCatalogImage(image.value, (reason) => {
    resolvedSrc.value = props.src;
    loadReason.value = reason;
    stopObserving = null;
  });
}

watch(() => [props.src, props.eager], () => void nextTick(prepare));
onMounted(prepare);
onBeforeUnmount(() => stopObserving?.());
</script>

<template>
  <img
    ref="image"
    :src="resolvedSrc || undefined"
    :alt="alt || ''"
    :loading="resolvedSrc ? 'eager' : 'lazy'"
    decoding="async"
    fetchpriority="auto"
    :data-load-reason="loadReason || undefined"
    :hidden="failed"
    @error="failed = true"
  />
</template>
