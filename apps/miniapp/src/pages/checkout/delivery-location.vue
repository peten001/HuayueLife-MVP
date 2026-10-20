<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref } from 'vue';
import { onLoad, onReady, onUnload } from '@dcloudio/uni-app';
import { formatDeliveryCoordinate, normalizeDeliveryCoordinate, stripDeliveryGpsSuffix, type DeliveryCoordinate } from '@huayue-life/shared';
import { useI18n, usePageTitle } from '@/i18n';
import { gcj02ToWgs84, wgs84ToGcj02 } from '@/utils/coordinates';
import { deliveryLocationText, type DeliveryLocationInitial, type DeliveryLocationSelection } from '@/utils/delivery-location';
import { ensurePrivacyAuthorized } from '@/utils/privacy';

const instance = getCurrentInstance();
const { locale } = useI18n();
const text = (key: Parameters<typeof deliveryLocationText>[1]) => deliveryLocationText(locale.value, key);
usePageTitle(() => text('title'));
const viewport = ref<DeliveryCoordinate>({ latitude: 21.281, longitude: 106.197 });
const selectedMapPoint = ref<DeliveryCoordinate | null>(null);
const address = ref('');
const satellite = ref(true);
const scale = ref(18);
const mapRendered = ref(false);
const reading = ref(false);
const moving = ref(false);
const searching = ref(false);
const locating = ref(false);
const confirming = ref(false);
const pendingCenter = ref<DeliveryCoordinate | null>(null);
const errorKey = ref<Parameters<typeof text>[0] | ''>('');
let mapContext: ReturnType<typeof uni.createMapContext> | null = null;
let eventChannel: UniApp.EventChannel | null = null;
let alive = true;
let confirmed = false;
let revision = 0;
let readId = 0;
let initialized = false;
const selectedWgs84 = computed(() => selectedMapPoint.value
  ? gcj02ToWgs84(selectedMapPoint.value.latitude, selectedMapPoint.value.longitude) : null);
const coordinateLabel = computed(() => selectedWgs84.value ? formatDeliveryCoordinate(selectedWgs84.value) : '—');
const addressLimit = computed(() => 255 - (selectedWgs84.value ? `\nGPS: ${formatDeliveryCoordinate(selectedWgs84.value)}`.length : 40));
const canConfirm = computed(() => mapRendered.value && selectedMapPoint.value !== null
  && !pendingCenter.value && !moving.value && !reading.value && !searching.value && !locating.value && !confirming.value);

onLoad(() => {
  const page = instance?.proxy as unknown as { getOpenerEventChannel?: () => UniApp.EventChannel };
  eventChannel = page?.getOpenerEventChannel?.() ?? null;
  eventChannel?.on('deliveryLocationInitial', (initial: DeliveryLocationInitial) => {
    initialized = true;
    address.value = stripDeliveryGpsSuffix(initial.address || '');
    const initialPoint = initial.coordinate ?? initial.fallbackCoordinate;
    if (normalizeDeliveryCoordinate(initialPoint?.latitude, initialPoint?.longitude)) {
      viewport.value = wgs84ToGcj02(initialPoint.latitude, initialPoint.longitude);
      pendingCenter.value = { ...viewport.value };
    }
    selectedMapPoint.value = initial.coordinate ? { ...viewport.value } : null;
    if (!initial.coordinate) void locate();
  });
});

onReady(() => {
  mapContext = uni.createMapContext('delivery-location-map', instance?.proxy);
  if (mapRendered.value && initialized && !locating.value) void readCenter(false);
});

onUnload(() => {
  alive = false;
  revision++;
  if (!confirmed) eventChannel?.emit('deliveryLocationCancelled');
});

async function readCenter(showError = true): Promise<DeliveryCoordinate | null> {
  if (!mapContext || !alive) return null;
  const currentRevision = revision;
  const currentRead = ++readId;
  reading.value = true;
  return new Promise((resolve) => {
    mapContext!.getCenterLocation({
      success: (result) => {
        if (!alive || currentRevision !== revision || currentRead !== readId) { resolve(null); return; }
        const coordinate = normalizeDeliveryCoordinate(result.latitude, result.longitude);
        // Native property updates and map animations are asynchronous. Never
        // confirm the previous center while waiting for a searched/GPS point.
        if (coordinate && pendingCenter.value
          && Math.max(Math.abs(coordinate.latitude - pendingCenter.value.latitude), Math.abs(coordinate.longitude - pendingCenter.value.longitude)) > 0.000002) {
          resolve(null); return;
        }
        pendingCenter.value = null;
        selectedMapPoint.value = coordinate;
        errorKey.value = coordinate ? '' : 'readFailed';
        resolve(coordinate);
      },
      fail: () => {
        if (alive && currentRevision === revision && currentRead === readId) {
          selectedMapPoint.value = null;
          if (showError) errorKey.value = 'readFailed';
        }
        resolve(null);
      },
      complete: () => { if (alive && currentRevision === revision && currentRead === readId) reading.value = false; },
    });
  });
}

function mapUpdated() {
  mapRendered.value = true;
  if (initialized && !locating.value && !moving.value && !confirming.value) void readCenter(false);
}

function regionChanged(event: { type?: string; causedBy?: string; detail?: { type?: string; causedBy?: string } }) {
  const phase = event.detail?.type || event.type;
  if (phase === 'begin') {
    revision++;
    if ((event.detail?.causedBy || event.causedBy) === 'gesture') pendingCenter.value = null;
    moving.value = true;
    reading.value = false;
  } else if (phase === 'end') {
    moving.value = false;
    void readCenter();
  }
}

async function centerAt(point: DeliveryCoordinate) {
  const currentRevision = ++revision;
  viewport.value = point;
  pendingCenter.value = point;
  selectedMapPoint.value = point;
  errorKey.value = '';
  await nextTick();
  if (!alive || currentRevision !== revision) return;
  if (mapContext && mapRendered.value) {
    mapContext.moveToLocation({ ...point, success: () => { if (alive) void readCenter(false); } });
  }
}

async function locate() {
  if (locating.value || !alive) return;
  if (!(await ensurePrivacyAuthorized()) || !alive) { errorKey.value = 'locateFailed'; return; }
  locating.value = true;
  const currentRevision = revision;
  uni.getLocation({
    type: 'gcj02', isHighAccuracy: true,
    success: (result) => {
      if (!alive || currentRevision !== revision) return;
      const coordinate = normalizeDeliveryCoordinate(result.latitude, result.longitude);
      if (coordinate) void centerAt(coordinate);
      else errorKey.value = 'locateFailed';
    },
    fail: () => { if (alive && currentRevision === revision) errorKey.value = 'locateFailed'; },
    complete: () => {
      if (!alive) return;
      locating.value = false;
      if (mapRendered.value && !moving.value) void readCenter(false);
    },
  });
}

async function searchAddress() {
  if (searching.value || confirming.value) return;
  if (!(await ensurePrivacyAuthorized()) || !alive) return;
  searching.value = true;
  uni.chooseLocation({
    latitude: viewport.value.latitude, longitude: viewport.value.longitude,
    success: (result) => {
      if (!alive) return;
      const coordinate = normalizeDeliveryCoordinate(result.latitude, result.longitude);
      if (!coordinate) { errorKey.value = 'readFailed'; return; }
      const parts = [result.address?.trim(), result.name?.trim()].filter(Boolean) as string[];
      address.value = parts.length === 2 && parts[0].includes(parts[1]) ? parts[0] : parts.join(' ');
      scale.value = 18;
      void centerAt(coordinate);
    },
    fail: (error) => { if (alive && !String(error.errMsg || '').toLowerCase().includes('cancel')) errorKey.value = 'searchFailed'; },
    complete: () => { if (alive) searching.value = false; },
  });
}

async function confirmLocation() {
  if (!canConfirm.value) return;
  if (address.value.trim().length > addressLimit.value) { errorKey.value = 'addressTooLong'; return; }
  confirming.value = true;
  const currentRevision = revision;
  try {
    const point = await readCenter();
    if (!point || !alive || moving.value || currentRevision !== revision) return;
    const coordinate = gcj02ToWgs84(point.latitude, point.longitude);
    const selection: DeliveryLocationSelection = { address: stripDeliveryGpsSuffix(address.value), coordinate, coordinateSystem: 'WGS84' };
    if (!eventChannel) { errorKey.value = 'readFailed'; return; }
    confirmed = true;
    await new Promise<void>((resolve) => uni.navigateBack({
      success: () => { eventChannel?.emit('deliveryLocationSelected', selection); resolve(); },
      fail: () => { confirmed = false; errorKey.value = 'readFailed'; resolve(); },
    }));
  } finally {
    if (alive) confirming.value = false;
  }
}
</script>

<template>
  <view class="delivery-location-page">
    <view class="location-toolbar">
      <button class="location-search" :disabled="searching || confirming" @tap="searchAddress"><view class="search-symbol" /><text>{{ text('search') }}</text></button>
      <view class="map-modes">
        <button :class="{ selected: satellite }" @tap="satellite = true">{{ text('satellite') }}</button>
        <button :class="{ selected: !satellite }" @tap="satellite = false">{{ text('normal') }}</button>
      </view>
    </view>
    <view class="delivery-map-stage"><map
      id="delivery-location-map"
      class="delivery-native-map"
      :latitude="viewport.latitude" :longitude="viewport.longitude" :scale="scale"
      :enable-satellite="satellite" :enable-scroll="true" :enable-zoom="true"
      :enable-rotate="false" :show-location="true" :show-compass="false"
      @regionchange="regionChanged" @updated="mapUpdated"
    >
      <cover-view class="map-hint"><cover-view>{{ text('hint') }}</cover-view><cover-view v-if="satellite" class="map-coverage-hint">{{ text('coverageHint') }}</cover-view></cover-view>
      <cover-view v-if="mapRendered" class="center-pin"><cover-view class="pin-head"><cover-view class="pin-dot" /></cover-view><cover-view class="pin-stem" /><cover-view class="pin-base" /></cover-view>
      <cover-view v-else class="map-loading">{{ text('loading') }}</cover-view>
      <cover-view class="map-locate" @tap.stop="locate">{{ text('locate') }}</cover-view>
    </map></view>
    <view class="location-confirm-panel">
      <text class="location-panel-title">{{ text('address') }}</text>
      <textarea v-model="address" class="location-address" :maxlength="addressLimit" :placeholder="text('placeholder')" :adjust-position="true" />
      <view class="location-coordinate"><text>{{ text('coordinate') }}</text><text user-select>{{ coordinateLabel }}</text></view>
      <text class="location-error" aria-live="polite">{{ errorKey ? text(errorKey) : '' }}</text>
      <button class="location-confirm" :disabled="!canConfirm" @tap="confirmLocation">{{ confirming ? text('confirming') : text('confirm') }}</button>
    </view>
  </view>
</template>

<style scoped>
.delivery-location-page { display: flex; flex-direction: column; box-sizing: border-box; height: 100vh; background: var(--hy-page); color: var(--hy-text); }
.location-toolbar { display: flex; flex: 0 0 auto; align-items: center; gap: 12rpx; padding: 16rpx 24rpx; background: var(--hy-surface); }
.location-search { display: flex; flex: 1; min-width: 0; min-height: 44px; align-items: center; justify-content: flex-start; gap: 14rpx; margin: 0; padding: 24rpx 20rpx; border-radius: 24rpx; background: var(--hy-page); color: var(--hy-muted); font-size: 25rpx; line-height: 1.4; text-align: left; }
.search-symbol { position: relative; flex: 0 0 24rpx; width: 24rpx; height: 24rpx; border: 3rpx solid var(--hy-muted); border-radius: 50%; }
.search-symbol::after { position: absolute; right: -9rpx; bottom: -6rpx; width: 12rpx; height: 3rpx; border-radius: 3rpx; background: var(--hy-muted); content: ''; transform: rotate(45deg); }
.map-modes { display: flex; flex: 0 0 auto; border-radius: 22rpx; padding: 4rpx; background: var(--hy-page); }
.map-modes button { min-width: 44px; min-height: 44px; margin: 0; padding: 24rpx 14rpx; border-radius: 18rpx; background: transparent; color: var(--hy-muted); font-size: 23rpx; line-height: 1.4; }
.map-modes button.selected { background: var(--hy-soft); color: var(--hy-primary-strong); font-weight: 600; }
.delivery-map-stage { position: relative; flex: 1; min-height: 160px; }
.delivery-native-map { position: absolute; width: 100%; height: 100%; }
.map-hint { position: absolute; top: 24rpx; right: 24rpx; left: 24rpx; padding: 16rpx 20rpx; border-radius: 24rpx; background: var(--hy-surface); color: var(--hy-text); font-size: 24rpx; line-height: 1.5; text-align: center; white-space: normal; }
.map-coverage-hint { margin-top: 6rpx; color: var(--hy-muted); font-size: 21rpx; line-height: 1.5; white-space: normal; }
.center-pin { position: absolute; top: 50%; left: 50%; width: 60rpx; height: 86rpx; margin-top: -86rpx; margin-left: -30rpx; }
.pin-head { display: flex; width: 54rpx; height: 54rpx; align-items: center; justify-content: center; margin: 0 auto; border: 4rpx solid var(--hy-surface); border-radius: 50%; background: var(--hy-primary-strong); }
.pin-dot { width: 16rpx; height: 16rpx; border-radius: 50%; background: var(--hy-surface); }
.pin-stem { width: 6rpx; height: 24rpx; margin: -2rpx auto 0; background: var(--hy-primary-strong); }
.pin-base { width: 12rpx; height: 8rpx; margin: 0 auto; border-radius: 50%; background: var(--hy-primary-strong); }
.map-loading { position: absolute; top: 50%; right: 24rpx; left: 24rpx; padding: 20rpx; border-radius: 24rpx; background: var(--hy-surface); color: var(--hy-muted); font-size: 26rpx; text-align: center; }
.map-locate { position: absolute; right: 24rpx; bottom: 24rpx; min-width: 88rpx; padding: 24rpx 16rpx; border-radius: 24rpx; background: var(--hy-surface); color: var(--hy-primary-strong); font-size: 24rpx; text-align: center; }
.location-confirm-panel { flex: 0 0 auto; padding: 24rpx 28rpx calc(24rpx + env(safe-area-inset-bottom)); background: var(--hy-surface); }
.location-panel-title { display: block; font-size: 29rpx; font-weight: 600; line-height: 1.4; }
.location-address { box-sizing: border-box; width: 100%; height: 100rpx; margin-top: 12rpx; padding: 16rpx 18rpx; border-radius: 24rpx; background: var(--hy-page); color: var(--hy-text); font-size: 27rpx; line-height: 1.5; }
.location-coordinate { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-top: 14rpx; color: var(--hy-muted); font-size: 23rpx; line-height: 1.4; }
.location-coordinate text:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.location-error { display: block; min-height: 36rpx; margin-top: 8rpx; color: var(--hy-error); font-size: 23rpx; line-height: 1.5; }
.location-confirm { display: flex; box-sizing: border-box; width: 100%; min-height: 44px; align-items: center; justify-content: center; margin: 8rpx 0 0; padding: 24rpx; border-radius: 28rpx; background: var(--hy-primary); color: var(--hy-surface); font-size: 30rpx; font-weight: 600; line-height: 1.4; }
.location-confirm:active { background: var(--hy-primary-strong); }
.location-confirm[disabled] { opacity: .5; cursor: not-allowed; }
</style>
