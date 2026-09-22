<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronRight, MapPin } from '@lucide/vue';
import { useI18n } from '@/i18n';

const props = withDefaults(defineProps<{
  latitude: number;
  longitude: number;
  expanded?: boolean;
  disabled?: boolean;
}>(), {
  expanded: false,
  disabled: false,
});

const { t } = useI18n();
const mapLoaded = ref(false);
const mapFailed = ref(false);
const loadedTiles = ref(0);
const failedTiles = ref(0);

const validPoint = computed(() => (
  Number.isFinite(props.latitude)
  && Number.isFinite(props.longitude)
  && Math.abs(props.latitude) <= 90
  && Math.abs(props.longitude) <= 180
));

const coordinates = computed(() => (
  `${props.latitude.toFixed(5)}, ${props.longitude.toFixed(5)}`
));

const locationUrl = computed(() => (
  `https://www.google.com/maps?q=${props.latitude},${props.longitude}`
));

const tileGrid = computed(() => {
  if (!validPoint.value) return [];
  const latitude = Math.max(-85, Math.min(85, props.latitude));
  const longitude = Math.max(-180, Math.min(180, props.longitude));
  const zoom = props.expanded ? 16 : 15;
  const scale = 2 ** zoom;
  const x = (longitude + 180) / 360 * scale;
  const latitudeRadians = latitude * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI) / 2 * scale;
  const centerX = Math.floor(x);
  const centerY = Math.floor(y);
  const result: Array<{ key: string; url: string }> = [];
  for (let row = -1; row <= 1; row += 1) {
    for (let column = -1; column <= 1; column += 1) {
      const tileX = (centerX + column + scale) % scale;
      const tileY = Math.max(0, Math.min(scale - 1, centerY + row));
      result.push({
        key: `${zoom}-${tileX}-${tileY}`,
        url: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`,
      });
    }
  }
  return result;
});

const tileLayerStyle = computed(() => {
  if (!validPoint.value) return {};
  const latitude = Math.max(-85, Math.min(85, props.latitude));
  const longitude = Math.max(-180, Math.min(180, props.longitude));
  const zoom = props.expanded ? 16 : 15;
  const scale = 2 ** zoom;
  const x = (longitude + 180) / 360 * scale;
  const latitudeRadians = latitude * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI) / 2 * scale;
  const offsetX = (x - Math.floor(x)) * 256;
  const offsetY = (y - Math.floor(y)) * 256;
  return {
    left: `calc(50% - ${256 + offsetX}px)`,
    top: `calc(50% - ${256 + offsetY}px)`,
  };
});

watch(
  () => [props.latitude, props.longitude, props.expanded],
  () => {
    mapLoaded.value = false;
    mapFailed.value = false;
    loadedTiles.value = 0;
    failedTiles.value = 0;
  },
);

function handleTileLoad() {
  loadedTiles.value += 1;
  mapLoaded.value = true;
  mapFailed.value = false;
}

function handleTileError() {
  failedTiles.value += 1;
  if (!mapLoaded.value && failedTiles.value >= tileGrid.value.length) {
    mapFailed.value = true;
  }
}
</script>

<template>
  <div
    class="chat-location-preview"
    :class="{
      'chat-location-preview--expanded': expanded,
      'chat-location-preview--disabled': disabled,
    }"
  >
    <div class="chat-location-preview__map" :aria-label="t('cashier.chat.mapPreview')">
      <div
        v-if="!mapLoaded || mapFailed"
        class="chat-location-preview__placeholder"
        :class="{ 'chat-location-preview__placeholder--failed': mapFailed || !validPoint }"
      >
        <MapPin :size="expanded ? 34 : 28" stroke-width="1.8" aria-hidden="true" />
        <span v-if="mapFailed || !validPoint">{{ t('cashier.chat.mapPreviewFailed') }}</span>
      </div>
      <div
        v-if="validPoint && !mapFailed"
        class="chat-location-preview__tiles"
        :class="{ 'is-loaded': mapLoaded }"
        :style="tileLayerStyle"
        aria-hidden="true"
      >
        <img
          v-for="tile in tileGrid"
          :key="tile.key"
          :src="tile.url"
          alt=""
          loading="lazy"
          draggable="false"
          @load="handleTileLoad"
          @error="handleTileError"
        />
      </div>
      <span class="chat-location-preview__pin" aria-hidden="true">
        <MapPin :size="24" fill="currentColor" stroke-width="1.8" />
      </span>
      <a
        class="chat-location-preview__attribution"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="OpenStreetMap copyright"
      >© OpenStreetMap</a>
    </div>

    <div class="chat-location-preview__footer">
      <span class="chat-location-preview__icon" aria-hidden="true">
        <MapPin :size="19" stroke-width="2" />
      </span>
      <span class="chat-location-preview__copy">
        <strong>{{ t('cashier.chat.openLocation') }}</strong>
        <small>{{ coordinates }}</small>
      </span>
      <ChevronRight :size="18" stroke-width="2" aria-hidden="true" />
    </div>

    <a
      v-if="!disabled && validPoint"
      class="chat-location-preview__link"
      :href="locationUrl"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="`${t('cashier.chat.openLocation')} ${coordinates}`"
    />
  </div>
</template>

<style scoped>
.chat-location-preview {
  position: relative;
  width: min(260px, 70vw);
  overflow: hidden;
  border: 1px solid #d5e1d8;
  border-radius: 14px;
  color: #1f3528;
  background: #f2f7f3;
  box-shadow: 0 4px 14px rgb(31 70 45 / 7%);
}

.chat-location-preview--expanded {
  width: 100%;
  border-radius: 16px;
}

.chat-location-preview__map {
  position: relative;
  height: 132px;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgb(255 255 255 / 36%) 1px, transparent 1px),
    linear-gradient(rgb(255 255 255 / 36%) 1px, transparent 1px),
    #dce9df;
  background-size: 24px 24px;
}

.chat-location-preview--expanded .chat-location-preview__map {
  height: 196px;
}

.chat-location-preview__tiles {
  position: absolute;
  display: grid;
  width: 768px;
  height: 768px;
  grid-template-columns: repeat(3, 256px);
  grid-template-rows: repeat(3, 256px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
}

.chat-location-preview__tiles.is-loaded {
  opacity: 1;
}

.chat-location-preview__tiles img {
  display: block;
  width: 256px;
  height: 256px;
  user-select: none;
}

.chat-location-preview__placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  z-index: 0;
  place-content: center;
  justify-items: center;
  gap: 7px;
  padding: 16px;
  color: #3f7452;
  text-align: center;
}

.chat-location-preview__placeholder::after {
  width: 72px;
  height: 7px;
  border-radius: 999px;
  background: rgb(55 113 74 / 12%);
  content: '';
  animation: location-preview-pulse 1.2s ease-in-out infinite;
}

.chat-location-preview__placeholder--failed::after {
  display: none;
}

.chat-location-preview__placeholder span {
  max-width: 210px;
  color: #66766c;
  font-size: 11px;
  line-height: 1.35;
}

.chat-location-preview__pin {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 1;
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 3px solid rgb(243 249 245 / 92%);
  border-radius: 50% 50% 50% 8px;
  color: #217a48;
  background: #f1f8f3;
  box-shadow: 0 5px 14px rgb(27 83 49 / 26%);
  transform: translate(-50%, -65%) rotate(-45deg);
}

.chat-location-preview__pin :deep(svg) {
  transform: rotate(45deg);
}

.chat-location-preview__attribution {
  position: absolute;
  bottom: 2px;
  left: 3px;
  z-index: 3;
  border-radius: 3px;
  padding: 1px 3px;
  color: #405449;
  background: rgb(247 250 248 / 82%);
  font-size: 8px;
  line-height: 1.2;
  text-decoration: none;
}

.chat-location-preview__footer {
  display: grid;
  min-height: 58px;
  grid-template-columns: 28px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  background: rgb(249 252 250 / 98%);
}

.chat-location-preview__icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 9px;
  color: #1f7b49;
  background: #e0f1e5;
}

.chat-location-preview__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.chat-location-preview__copy strong {
  font-size: 13px;
  line-height: 1.25;
}

.chat-location-preview__copy small {
  overflow: hidden;
  color: #6c7a71;
  font-size: 10px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-location-preview__footer > svg {
  color: #829188;
}

.chat-location-preview__link {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
}

.chat-location-preview__link:focus-visible {
  outline: 3px solid rgb(46 125 50 / 38%);
  outline-offset: -3px;
}

.chat-location-preview:not(.chat-location-preview--disabled):active {
  transform: scale(.992);
}

.chat-location-preview--disabled {
  box-shadow: none;
}

@media (hover: hover) {
  .chat-location-preview:not(.chat-location-preview--disabled):hover {
    border-color: #a9c9b2;
    box-shadow: 0 7px 18px rgb(31 70 45 / 12%);
  }
}

@media (max-width: 520px) {
  .chat-location-preview {
    width: min(252px, 70vw);
    border-radius: 13px;
  }

  .chat-location-preview--expanded {
    width: 100%;
  }

  .chat-location-preview__map {
    height: 124px;
  }

  .chat-location-preview--expanded .chat-location-preview__map {
    height: 178px;
  }
}

@keyframes location-preview-pulse {
  0%, 100% { opacity: .36; transform: scaleX(.74); }
  50% { opacity: .82; transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .chat-location-preview__tiles,
  .chat-location-preview {
    transition: none;
  }

  .chat-location-preview__placeholder::after {
    animation: none;
  }
}
</style>
