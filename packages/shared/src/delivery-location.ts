import { usesGcj02Offset } from './coordinates';

export interface DeliveryCoordinate {
  latitude: number;
  longitude: number;
}

const GPS_SUFFIX = /(?:^|\r?\n)GPS:\s*(-?\d{1,3}(?:\.\d{1,7})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,7})?)\s*$/;

export function normalizeDeliveryCoordinate(latitude: unknown, longitude: unknown): DeliveryCoordinate | null {
  if ((typeof latitude !== 'number' && typeof latitude !== 'string')
    || (typeof longitude !== 'number' && typeof longitude !== 'string')
    || String(latitude).trim() === '' || String(longitude).trim() === '') return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) return null;
  return { latitude: lat, longitude: lng };
}

export function formatDeliveryCoordinate(coordinate: DeliveryCoordinate): string {
  return `${coordinate.latitude.toFixed(7)}, ${coordinate.longitude.toFixed(7)}`;
}

export function stripDeliveryGpsSuffix(address: string): string {
  return address.trim().replace(GPS_SUFFIX, '').trim();
}

/** The GPS suffix is always WGS84, written only after the selected map point is converted. */
export function deliveryAddressWithCoordinate(address: string, coordinate: DeliveryCoordinate | null): string {
  const text = stripDeliveryGpsSuffix(address);
  if (!coordinate) return text;
  return [text, `GPS: ${formatDeliveryCoordinate(coordinate)}`].filter(Boolean).join('\n');
}

export function deliveryCoordinateFromAddress(address: string): DeliveryCoordinate | null {
  const match = address.trim().match(GPS_SUFFIX);
  return match ? normalizeDeliveryCoordinate(match[1], match[2]) : null;
}

/** Older orders have coordinate columns without a WGS84 marker in their address.
 * Outside the offset region GCJ02 and WGS84 use the same point. Mainland legacy
 * columns need a known coordinate system; do not guess or convert them twice.
 */
export function googleMapsDeliverySearchUrl(
  address: string | null | undefined,
  orderCoordinate?: { latitude: unknown; longitude: unknown } | null,
): string {
  const recorded = deliveryCoordinateFromAddress(address || '');
  const legacy = normalizeDeliveryCoordinate(orderCoordinate?.latitude, orderCoordinate?.longitude);
  const coordinate = recorded ?? (legacy && !usesGcj02Offset(legacy.latitude, legacy.longitude) ? legacy : null);
  if (!coordinate) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatDeliveryCoordinate(coordinate))}`;
}
