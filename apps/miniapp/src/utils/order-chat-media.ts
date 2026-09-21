import { resolveMediaUrl } from './media';

export type ChatLocationSelection = {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
};

type ChatMediaLabel =
  | 'image'
  | 'location'
  | 'openLocation'
  | 'imageFailed'
  | 'imageTooLarge'
  | 'locationFailed'
  | 'more'
  | 'choosePhoto'
  | 'chooseLocation'
  | 'selectedLocation'
  | 'confirmLocation'
  | 'sendLocation';

const labels: Record<'zh' | 'vi' | 'en', Record<ChatMediaLabel, string>> = {
  zh: {
    image: '图片', location: '位置', openLocation: '查看位置',
    imageFailed: '图片发送失败', imageTooLarge: '图片不能超过 5MB', locationFailed: '无法获取当前位置，请检查定位权限',
    more: '更多', choosePhoto: '照片', chooseLocation: '位置', selectedLocation: '已选择位置',
    confirmLocation: '确认发送此位置', sendLocation: '发送位置',
  },
  vi: {
    image: 'Ảnh', location: 'Vị trí', openLocation: 'Xem vị trí',
    imageFailed: 'Gửi ảnh thất bại', imageTooLarge: 'Ảnh không được vượt quá 5MB', locationFailed: 'Không lấy được vị trí. Hãy kiểm tra quyền định vị',
    more: 'Thêm', choosePhoto: 'Ảnh', chooseLocation: 'Vị trí', selectedLocation: 'Vị trí đã chọn',
    confirmLocation: 'Xác nhận gửi vị trí này', sendLocation: 'Gửi vị trí',
  },
  en: {
    image: 'Photo', location: 'Location', openLocation: 'View location',
    imageFailed: 'Photo could not be sent', imageTooLarge: 'Photo must be under 5MB', locationFailed: 'Location unavailable. Check location permission',
    more: 'More', choosePhoto: 'Photo', chooseLocation: 'Location', selectedLocation: 'Selected location',
    confirmLocation: 'Send this location?', sendLocation: 'Send location',
  },
};

export function chatMediaLabel(locale: string, key: ChatMediaLabel) {
  return labels[locale as keyof typeof labels]?.[key] ?? labels.zh[key];
}

export function chooseChatImage(): Promise<{ path: string; size: number | null } | null> {
  return new Promise((resolve) => {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success(result) {
        const path = result.tempFilePaths?.[0];
        if (!path) { resolve(null); return; }
        const file = Array.isArray(result.tempFiles) ? result.tempFiles[0] : result.tempFiles;
        resolve({ path, size: file?.size ?? null });
      },
      fail() { resolve(null); },
    });
  });
}

export function chooseChatLocation(): Promise<ChatLocationSelection | null> {
  return new Promise((resolve, reject) => {
    uni.chooseLocation({
      success(result) {
        resolve({
          latitude: result.latitude,
          longitude: result.longitude,
          name: result.name?.trim() ?? '',
          address: result.address?.trim() ?? '',
        });
      },
      fail(error) {
        if (String(error.errMsg ?? '').toLowerCase().includes('cancel')) {
          resolve(null);
          return;
        }
        reject(new Error(error.errMsg || 'Location unavailable'));
      },
    });
  });
}

export function previewChatImage(mediaUrl: string) {
  const url = resolveMediaUrl(mediaUrl);
  if (url) uni.previewImage({ current: url, urls: [url] });
}

export function openChatLocation(
  latitude?: number | null,
  longitude?: number | null,
  name?: string,
  address?: string,
) {
  if (latitude == null || longitude == null) return;
  uni.openLocation({ latitude, longitude, scale: 16, name, address });
}
