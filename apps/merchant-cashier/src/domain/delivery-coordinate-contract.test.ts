import { describe, expect, it } from 'vitest';
import {
  deliveryAddressWithCoordinate, deliveryCoordinateFromAddress, googleMapsDeliverySearchUrl,
  normalizeDeliveryCoordinate, stripDeliveryGpsSuffix,
} from '@huayue-life/shared';
import { gcj02ToWgs84, wgs84ToGcj02 } from '../../../miniapp/src/utils/coordinates';

describe('Tencent delivery point to Google Maps contract', () => {
  it.each([
    [21.1861, 106.0763], // Bac Ninh, inside the common but incorrect China rectangle
    [21.281, 106.197], // Bac Giang
    [21.0285, 105.8542], // Hanoi
    [22.833, 104.98], // Ha Giang
    [10.7769, 106.7009], [22.3193, 114.1694], [25.033, 121.5654], [35.6762, 139.6503],
  ])('keeps overseas coordinates unchanged (%s, %s)', (latitude, longitude) => {
    expect(wgs84ToGcj02(latitude, longitude)).toEqual({ latitude, longitude });
    expect(gcj02ToWgs84(latitude, longitude)).toEqual({ latitude, longitude });
  });

  it('converts a known Beijing point and reverses the offset', () => {
    const native = wgs84ToGcj02(39.908823, 116.39747);
    expect(native.latitude).toBeCloseTo(39.9102265, 6);
    expect(native.longitude).toBeCloseTo(116.4037136, 6);
    expect(gcj02ToWgs84(native.latitude, native.longitude)).toEqual({ latitude: 39.908823, longitude: 116.39747 });
  });

  it.each([[22.817, 108.3665], [20.044, 110.1999], [31.2304, 121.4737], [43.8256, 87.6168]])(
    'round-trips mainland points including southern China (%s, %s)', (latitude, longitude) => {
      const native = wgs84ToGcj02(latitude, longitude);
      expect(native).not.toEqual({ latitude, longitude });
      const restored = gcj02ToWgs84(native.latitude, native.longitude);
      expect(restored.latitude).toBeCloseTo(latitude, 6);
      expect(restored.longitude).toBeCloseTo(longitude, 6);
    },
  );

  it.each([[null, null], ['', ''], [' ', 106], [0, 0], [91, 106], [21, -181], [NaN, 106], [Infinity, 106], [{}, 106]])(
    'rejects unusable native/map coordinates (%s, %s)', (latitude, longitude) => {
      expect(normalizeDeliveryCoordinate(latitude, longitude)).toBeNull();
    },
  );

  it('accepts numeric API strings, equator and western/southern points', () => {
    expect(normalizeDeliveryCoordinate('21.2810000', '106.1970000')).toEqual({ latitude: 21.281, longitude: 106.197 });
    expect(normalizeDeliveryCoordinate(0, -78.5)).toEqual({ latitude: 0, longitude: -78.5 });
    expect(normalizeDeliveryCoordinate(-33.86, 151.2)).toEqual({ latitude: -33.86, longitude: 151.2 });
  });

  it('replaces the suffix on reselection and preserves editable address details', () => {
    const first = deliveryAddressWithCoordinate('园区北门 / Cổng bắc', { latitude: 21.2, longitude: 106.1 });
    const next = deliveryAddressWithCoordinate(first, { latitude: 21.281, longitude: 106.197 });
    expect(next).toBe('园区北门 / Cổng bắc\nGPS: 21.2810000, 106.1970000');
    expect(stripDeliveryGpsSuffix(next)).toBe('园区北门 / Cổng bắc');
    expect(deliveryCoordinateFromAddress(next)).toEqual({ latitude: 21.281, longitude: 106.197 });
  });

  it('searches converted coordinates without starting navigation', () => {
    const native = wgs84ToGcj02(39.908823, 116.39747);
    const address = deliveryAddressWithCoordinate('入口尚无完整门牌', gcj02ToWgs84(native.latitude, native.longitude));
    const url = new URL(googleMapsDeliverySearchUrl(address));
    expect(url.origin).toBe('https://www.google.com');
    expect(url.pathname).toBe('/maps/search/');
    expect([...url.searchParams]).toEqual([['api', '1'], ['query', '39.9088230, 116.3974700']]);
  });

  it('does not open Google search for missing coordinates or invalid suffixes', () => {
    for (const address of ['12 Test Street & cổng=2', '北江 3 号门', '入口\nGPS: 99, 106', 'GPS: 0, 0']) {
      expect(googleMapsDeliverySearchUrl(address)).toBe('');
    }
    expect(googleMapsDeliverySearchUrl('  ')).toBe('');
    expect(googleMapsDeliverySearchUrl(null)).toBe('');
  });

  it('keeps multilingual multiline address text separate from coordinate-only search', () => {
    const address = '北门 12 号\r\nCổng bắc, tòa nhà 3\r\nGPS: 21.2810000, 106.1970000';
    expect(stripDeliveryGpsSuffix(address)).toBe('北门 12 号\r\nCổng bắc, tòa nhà 3');
    expect(new URL(googleMapsDeliverySearchUrl(address)).searchParams.get('query')).toBe('21.2810000, 106.1970000');
  });
});
