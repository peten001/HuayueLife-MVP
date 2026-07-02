export type MerchantMapTarget = {
  latitude: number;
  longitude: number;
  name: string;
  address?: string;
};

function normalizeTarget(target: MerchantMapTarget): MerchantMapTarget {
  const latitude = Number(target.latitude);
  const longitude = Number(target.longitude);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    throw new Error('Invalid merchant coordinates');
  }

  return {
    latitude,
    longitude,
    name: String(target.name ?? '').trim(),
    address: typeof target.address === 'string' ? target.address.trim() : '',
  };
}

export function buildGoogleMapsUrl(target: MerchantMapTarget): string {
  const normalized = normalizeTarget(target);
  const destination = encodeURIComponent(
    `${normalized.latitude},${normalized.longitude}`,
  );

  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
}

export function buildAmapUrl(target: MerchantMapTarget): string {
  const normalized = normalizeTarget(target);
  const position = encodeURIComponent(
    `${normalized.longitude},${normalized.latitude}`,
  );
  const name = encodeURIComponent(normalized.name || 'Merchant');

  return `https://uri.amap.com/marker?position=${position}&name=${name}&src=huayueyouxuan&coordinate=wgs84&callnative=1`;
}

export function openSystemMap(target: MerchantMapTarget): Promise<void> {
  const normalized = normalizeTarget(target);

  return new Promise((resolve, reject) => {
    uni.openLocation({
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      name: normalized.name,
      address: normalized.address,
      scale: 16,
      success: () => resolve(),
      fail: (error) => reject(error),
    });
  });
}
