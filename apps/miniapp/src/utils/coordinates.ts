import { gcj02OffsetRegion } from './china-coordinate-region';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function isValidCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

function pointInRing(longitude: number, latitude: number, ring: number[][]) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x, y] = ring[current];
    const [previousX, previousY] = ring[previous];
    if ((y > latitude) !== (previousY > latitude)
      && longitude < ((previousX - x) * (latitude - y)) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

// A rectangular China bounding box includes Vietnam. Use the land geometry so
// Bac Ninh, Bac Giang and other overseas points never receive an artificial offset.
function usesGcj02Offset(latitude: number, longitude: number) {
  if (longitude < 72 || longitude > 136 || latitude < 18 || latitude > 54) return false;
  return gcj02OffsetRegion.some((polygon) => pointInRing(longitude, latitude, polygon[0])
    && !polygon.slice(1).some((hole) => pointInRing(longitude, latitude, hole)));
}

function transformLatitude(x: number, y: number) {
  let value =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));

  value +=
    ((20.0 * Math.sin(6.0 * x * PI) +
      20.0 * Math.sin(2.0 * x * PI)) *
      2.0) /
    3.0;
  value +=
    ((20.0 * Math.sin(y * PI) +
      40.0 * Math.sin((y / 3.0) * PI)) *
      2.0) /
    3.0;
  value +=
    ((160.0 * Math.sin((y / 12.0) * PI) +
      320 * Math.sin((y * PI) / 30.0)) *
      2.0) /
    3.0;

  return value;
}

function transformLongitude(x: number, y: number) {
  let value =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));

  value +=
    ((20.0 * Math.sin(6.0 * x * PI) +
      20.0 * Math.sin(2.0 * x * PI)) *
      2.0) /
    3.0;
  value +=
    ((20.0 * Math.sin(x * PI) +
      40.0 * Math.sin((x / 3.0) * PI)) *
      2.0) /
    3.0;
  value +=
    ((150.0 * Math.sin((x / 12.0) * PI) +
      300.0 * Math.sin((x / 30.0) * PI)) *
      2.0) /
    3.0;

  return value;
}

// Merchant coordinates remain stored as WGS84 in DB/API.
// Only convert at the native Tencent map boundary; overseas points stay WGS84.
export function wgs84ToGcj02(
  latitude: number,
  longitude: number,
): Coordinate {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!isValidCoordinate(lat, lon) || !usesGcj02Offset(lat, lon)) {
    return {
      latitude: lat,
      longitude: lon,
    };
  }

  const dLat = transformLatitude(lon - 105.0, lat - 35.0);
  const dLon = transformLongitude(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  const magic = Math.sin(radLat);
  const correctedMagic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(correctedMagic);

  const deltaLat =
    (dLat * 180.0) /
    (((A * (1 - EE)) / (correctedMagic * sqrtMagic)) * PI);
  const deltaLon =
    (dLon * 180.0) /
    ((A / sqrtMagic) * Math.cos(radLat) * PI);

  return {
    latitude: Number((lat + deltaLat).toFixed(7)),
    longitude: Number((lon + deltaLon).toFixed(7)),
  };
}


/** Inverse at confirmation time. Never repeatedly convert cached WGS84 points. */
export function gcj02ToWgs84(latitude: number, longitude: number): Coordinate {
  const point = { latitude: Number(latitude), longitude: Number(longitude) };
  if (!isValidCoordinate(point.latitude, point.longitude) || !usesGcj02Offset(point.latitude, point.longitude)) return point;
  let wgsLatitude = point.latitude;
  let wgsLongitude = point.longitude;
  for (let iteration = 0; iteration < 12; iteration++) {
    const projected = wgs84ToGcj02(wgsLatitude, wgsLongitude);
    const latitudeError = projected.latitude - point.latitude;
    const longitudeError = projected.longitude - point.longitude;
    wgsLatitude -= latitudeError;
    wgsLongitude -= longitudeError;
    if (Math.max(Math.abs(latitudeError), Math.abs(longitudeError)) < 0.0000001) break;
  }
  return { latitude: Number(wgsLatitude.toFixed(7)), longitude: Number(wgsLongitude.toFixed(7)) };
}
