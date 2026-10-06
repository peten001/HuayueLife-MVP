<script setup lang="ts">
import { computed, onUnmounted, ref, useAttrs, watch } from 'vue';
import { mediaImageCandidates } from '@/utils/media';

const props = withDefaults(defineProps<{
  src: string;
  variant?: 'original' | 'card';
  mode?: 'aspectFill' | 'aspectFit';
  lazyLoad?: boolean;
  ariaLabel?: string;
}>(), { variant: 'original', mode: 'aspectFill', lazyLoad: false, ariaLabel: '' });
const emit = defineEmits<{ error: []; load: []; tap: [] }>();
const attrs = useAttrs();
const candidates = computed(() => mediaImageCandidates(props.src, props.variant));
const candidate = ref(0);
const loaded = ref(false);
const rendering = ref(true);
const version = ref(0);
let retried = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const attempts = computed(() => rendering.value && candidates.value[candidate.value]
  ? [{ id: version.value, url: candidates.value[candidate.value] }] : []);

function clearRetry() { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } }
watch(() => [props.src, props.variant], () => {
  clearRetry(); candidate.value = 0; loaded.value = false; rendering.value = true; retried = false; version.value += 1;
});
onUnmounted(clearRetry);

function handleError(id: number) {
  if (id !== version.value) return;
  loaded.value = false;
  if (!retried) {
    retried = true;
    rendering.value = false;
    version.value += 1;
    timer = setTimeout(() => { timer = undefined; rendering.value = true; }, 400);
  } else if (candidate.value + 1 < candidates.value.length) {
    candidate.value += 1;
    version.value += 1;
  } else {
    rendering.value = false;
    version.value += 1;
    emit('error');
  }
}
function handleLoad(id: number) { if (id === version.value) { loaded.value = true; emit('load'); } }
</script>

<template>
  <view class="network-image" :class="attrs.class" :aria-label="ariaLabel" @tap="emit('tap')">
    <image
      v-for="attempt in attempts" :key="attempt.id" :src="attempt.url" :mode="mode"
      :lazy-load="lazyLoad" :class="['network-image-content', { 'is-loaded': loaded }]"
      @load="handleLoad(attempt.id)" @error="handleError(attempt.id)"
    />
  </view>
</template>

<style scoped>
.network-image { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; background: #f1f4f1; }
.network-image-content { display: block; width: 100%; height: 100%; opacity: 0; transition: opacity .12s ease; }
.network-image-content.is-loaded { opacity: 1; }
</style>
