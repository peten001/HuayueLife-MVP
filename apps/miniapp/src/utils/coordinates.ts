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
// Only convert them to GCJ-02 immediately before calling uni.openLocation.
export function wgs84ToGcj02(
  latitude: number,
  longitude: number,
): Coordinate {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!isValidCoordinate(lat, lon)) {
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
