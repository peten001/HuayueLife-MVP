<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import MerchantIcon from '@/components/MerchantIcon.vue';
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

const coordinates = computed(() => `${props.latitude.toFixed(5)}, ${props.longitude.toFixed(5)}`);
const locationUrl = computed(() => `https://www.google.com/maps?q=${props.latitude},${props.longitude}`);
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
      result.push({ key: `${zoom}-${tileX}-${tileY}`, url: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png` });
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
  return {
    left: `calc(50% - ${256 + (x - Math.floor(x)) * 256}px)`,
    top: `calc(50% - ${256 + (y - Math.floor(y)) * 256}px)`,
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
  if (!mapLoaded.value && failedTiles.value >= tileGrid.value.length) mapFailed.value = true;
}
</script>

<template>
  <div
    class="order-chat-location"
    :class="{
      'order-chat-location--expanded': expanded,
      'order-chat-location--disabled': disabled,
    }"
  >
    <div class="order-chat-location__map" :aria-label="t('chatMapPreview')">
      <div
        v-if="!mapLoaded || mapFailed"
        class="order-chat-location__placeholder"
        :class="{ 'order-chat-location__placeholder--failed': mapFailed || !validPoint }"
      >
        <MerchantIcon name="location" />
        <span v-if="mapFailed || !validPoint">{{ t('chatMapPreviewFailed') }}</span>
      </div>
      <div
        v-if="validPoint && !mapFailed"
        class="order-chat-location__tiles"
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
      <span class="order-chat-location__pin" aria-hidden="true">
        <MerchantIcon name="location" />
      </span>
      <a class="order-chat-location__attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" aria-label="OpenStreetMap copyright">© OpenStreetMap</a>
    </div>
    <div class="order-chat-location__footer">
      <span class="order-chat-location__icon" aria-hidden="true">
        <MerchantIcon name="location" />
      </span>
      <span class="order-chat-location__copy">
        <strong>{{ t('chatOpenLocation') }}</strong>
        <small>{{ coordinates }}</small>
      </span>
      <MerchantIcon name="chevron-right" />
    </div>
    <a
      v-if="!disabled && validPoint"
      class="order-chat-location__link"
      :href="locationUrl"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="`${t('chatOpenLocation')} ${coordinates}`"
    />
  </div>
</template>

<style scoped>
.order-chat-location {
  position: relative;
  width: min(272px, 58vw);
  overflow: hidden;
  border: 1px solid #d3e0d6;
  border-radius: 15px;
  color: #1f3528;
  background: #f2f7f3;
  box-shadow: 0 4px 14px rgb(31 70 45 / 7%);
}

.order-chat-location--expanded { width: 100%; }
.order-chat-location--disabled { box-shadow: none; }

.order-chat-location__map {
  position: relative;
  height: 142px;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgb(255 255 255 / 36%) 1px, transparent 1px),
    linear-gradient(rgb(255 255 255 / 36%) 1px, transparent 1px),
    #dce9df;
  background-size: 24px 24px;
}

.order-chat-location--expanded .order-chat-location__map { height: 210px; }

.order-chat-location__tiles {
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

.order-chat-location__tiles.is-loaded { opacity: 1; }
.order-chat-location__tiles img { display: block; width: 256px; height: 256px; user-select: none; }

.order-chat-location__placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 7px;
  padding: 16px;
  color: #3f7452;
  text-align: center;
}

.order-chat-location__placeholder :deep(svg) { width: 30px; height: 30px; }
.order-chat-location__placeholder span { max-width: 220px; color: #66766c; font-size: 11px; line-height: 1.35; }

.order-chat-location__placeholder::after {
  width: 72px;
  height: 7px;
  border-radius: 999px;
  background: rgb(55 113 74 / 12%);
  content: '';
  animation: admin-location-pulse 1.2s ease-in-out infinite;
}

.order-chat-location__placeholder--failed::after { display: none; }

.order-chat-location__pin {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 1;
  display: grid;
  width: 37px;
  height: 37px;
  place-items: center;
  border: 3px solid rgb(243 249 245 / 92%);
  border-radius: 50% 50% 50% 8px;
  color: #217a48;
  background: #f1f8f3;
  box-shadow: 0 5px 14px rgb(27 83 49 / 26%);
  transform: translate(-50%, -65%) rotate(-45deg);
}

.order-chat-location__pin :deep(svg) { width: 23px; height: 23px; transform: rotate(45deg); }

.order-chat-location__attribution {
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

.order-chat-location__footer {
  display: grid;
  min-height: 60px;
  grid-template-columns: 30px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  background: rgb(249 252 250 / 98%);
}

.order-chat-location__icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 9px;
  color: #1f7b49;
  background: #e0f1e5;
}

.order-chat-location__icon :deep(svg) { width: 19px; height: 19px; }
.order-chat-location__copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.order-chat-location__copy strong { font-size: 13px; line-height: 1.25; }
.order-chat-location__copy small { overflow: hidden; color: #6c7a71; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.order-chat-location__footer > :deep(svg) { color: #829188; }

.order-chat-location__link { position: absolute; inset: 0; z-index: 2; border-radius: inherit; }
.order-chat-location__link:focus-visible { outline: 3px solid rgb(46 125 50 / 38%); outline-offset: -3px; }
.order-chat-location:not(.order-chat-location--disabled):active { transform: scale(.992); }

@media (hover: hover) {
  .order-chat-location:not(.order-chat-location--disabled):hover {
    border-color: #a9c9b2;
    box-shadow: 0 7px 18px rgb(31 70 45 / 12%);
  }
}

@media (max-width: 760px) {
  .order-chat-location { width: min(258px, 70vw); }
  .order-chat-location--expanded { width: 100%; }
  .order-chat-location__map { height: 126px; }
  .order-chat-location--expanded .order-chat-location__map { height: 180px; }
}

@keyframes admin-location-pulse {
  0%, 100% { opacity: .36; transform: scaleX(.74); }
  50% { opacity: .82; transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .order-chat-location__tiles { transition: none; }
  .order-chat-location__placeholder::after { animation: none; }
}
</style>
