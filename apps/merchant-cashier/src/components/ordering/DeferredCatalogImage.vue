<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
  catalogImageSessionStatus,
  observeCatalogImage,
  setCatalogImageSessionStatus,
  type CatalogImageLoadReason,
} from './catalog-image-visibility';

const props = defineProps<{
  src: string;
  alt?: string;
  eager?: boolean;
  cacheKey?: string;
}>();

const image = ref<HTMLImageElement | null>(null);
const resolvedSrc = ref('');
type CatalogImageLoadState = 'deferred' | 'loading' | 'loaded' | 'failed';
const loadState = ref<CatalogImageLoadState>('deferred');
const loadReason = ref<CatalogImageLoadReason | ''>('');
let stopObserving: (() => void) | null = null;
let sessionRoot: HTMLElement | null = null;
let sessionKey = '';

function ensureImageLoaded(reason: CatalogImageLoadReason) {
  if (!props.src || resolvedSrc.value === props.src) return;
  const status = catalogImageSessionStatus(sessionRoot, sessionKey);
  if (status === 'failed') {
    loadState.value = 'failed';
    loadReason.value = 'session-cache';
    return;
  }
  if (!status) setCatalogImageSessionStatus(sessionRoot, sessionKey, 'loading');
  loadState.value = 'loading';
  resolvedSrc.value = props.src;
  loadReason.value = status ? 'session-cache' : reason;
}

function markLoaded() {
  if (loadState.value !== 'loading' || resolvedSrc.value !== props.src) return;
  setCatalogImageSessionStatus(sessionRoot, sessionKey, 'loaded');
  loadState.value = 'loaded';
}

function markFailed() {
  if (loadState.value !== 'loading' || resolvedSrc.value !== props.src) return;
  setCatalogImageSessionStatus(sessionRoot, sessionKey, 'failed');
  loadState.value = 'failed';
}

function prepare() {
  stopObserving?.();
  stopObserving = null;
  resolvedSrc.value = '';
  loadState.value = 'deferred';
  loadReason.value = '';
  sessionRoot = null;
  sessionKey = '';
  if (!props.src || !image.value) return;
  sessionRoot = image.value.closest<HTMLElement>('.table-ordering-products__scroller');
  sessionKey = `${props.cacheKey || props.src}\u0000${props.src}`;
  const sessionStatus = catalogImageSessionStatus(sessionRoot, sessionKey);
  if (sessionStatus === 'failed') {
    loadState.value = 'failed';
    loadReason.value = 'session-cache';
    return;
  }
  if (sessionStatus) {
    ensureImageLoaded('session-cache');
    return;
  }
  stopObserving = observeCatalogImage(image.value, (reason) => {
    ensureImageLoaded(reason);
    stopObserving = null;
  }, { eager: props.eager });
}

watch(() => [props.src, props.eager, props.cacheKey], () => void nextTick(prepare));
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
    fetchpriority="low"
    :data-load-reason="loadReason || undefined"
    :data-load-state="loadState"
    :hidden="loadState === 'failed'"
    @load="markLoaded"
    @error="markFailed"
  />
</template>
