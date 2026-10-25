import { normalizeDeliveryCoordinate, stripDeliveryGpsSuffix, type DeliveryCoordinate } from '@huayue-life/shared';
import { gcj02ToWgs84, wgs84ToGcj02 } from '@/utils/coordinates';
import { ensurePrivacyAuthorized } from '@/utils/privacy';

export interface DeliveryLocationSelection {
  address: string;
  coordinate: DeliveryCoordinate;
  coordinateSystem: 'WGS84';
}

export interface DeliveryLocationInitial {
  coordinate: DeliveryCoordinate | null;
  fallbackCoordinate: DeliveryCoordinate;
}

export async function chooseDeliveryLocation(initial: DeliveryLocationInitial): Promise<DeliveryLocationSelection | null> {
  if (!(await ensurePrivacyAuthorized())) return null;
  const coordinate = normalizeDeliveryCoordinate(initial.coordinate?.latitude, initial.coordinate?.longitude)
    ?? normalizeDeliveryCoordinate(initial.fallbackCoordinate.latitude, initial.fallbackCoordinate.longitude);
  const mapPoint = coordinate ? wgs84ToGcj02(coordinate.latitude, coordinate.longitude) : {};
  return new Promise((resolve, reject) => {
    uni.chooseLocation({
      ...mapPoint,
      success: (result) => {
        const selected = normalizeDeliveryCoordinate(result.latitude, result.longitude);
        if (!selected) { reject(new Error('Invalid delivery location')); return; }
        const address = stripDeliveryGpsSuffix(result.address || '');
        const name = stripDeliveryGpsSuffix(result.name || '');
        resolve({
          address: address.includes(name) ? address : [address, name].filter(Boolean).join(' '),
          coordinate: gcj02ToWgs84(selected.latitude, selected.longitude),
          coordinateSystem: 'WGS84',
        });
      },
      fail: (error) => {
        if (String(error.errMsg || '').toLowerCase().includes('cancel')) resolve(null);
        else reject(error);
      },
    });
  });
}

const labels = {
  zh: {
    coordinate: '定位坐标',
    selectionHint: '请将地图指针移到具体收餐点，方便商家准确送达',
    readFailed: '暂时无法读取位置，请移动地图后重试',
    addressTooLong: '地址过长，请精简文字后重试', chooseFailed: '无法打开地图，请稍后重试',
    selected: '已选择收餐点，可补充门牌或楼栋',
    selectedWithoutAddress: '已选择收餐点，请补充详细配送地址',
  },
  vi: {
    coordinate: 'Tọa độ',
    selectionHint: 'Di chuyển ghim bản đồ đến đúng điểm nhận món để cửa hàng giao chính xác.',
    readFailed: 'Chưa đọc được vị trí. Hãy di chuyển bản đồ rồi thử lại',
    addressTooLong: 'Địa chỉ quá dài. Vui lòng rút gọn rồi thử lại', chooseFailed: 'Chưa mở được bản đồ. Vui lòng thử lại',
    selected: 'Đã chọn điểm nhận món. Có thể thêm số nhà hoặc tòa nhà',
    selectedWithoutAddress: 'Đã chọn điểm nhận món. Vui lòng bổ sung địa chỉ giao hàng chi tiết',
  },
  en: {
    coordinate: 'Coordinates',
    selectionHint: 'Move the map pin to your exact delivery spot so the merchant can find you.',
    readFailed: 'Location could not be read. Move the map and try again',
    addressTooLong: 'The address is too long. Please shorten it and try again', chooseFailed: 'Map could not be opened. Please try again',
    selected: 'Delivery point selected. You can add a house or building number',
    selectedWithoutAddress: 'Delivery point selected. Please add a detailed delivery address',
  },
};

export function deliveryLocationText(locale: string, key: keyof typeof labels.zh) {
  return labels[locale as keyof typeof labels]?.[key] ?? labels.zh[key];
}
