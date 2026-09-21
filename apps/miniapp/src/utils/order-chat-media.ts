import { resolveMediaUrl } from './media';

type ChatMediaLabel = 'image' | 'location' | 'openLocation' | 'imageFailed' | 'imageTooLarge' | 'locationFailed';

const labels: Record<'zh' | 'vi' | 'en', Record<ChatMediaLabel, string>> = {
  zh: {
    image: '图片', location: '位置', openLocation: '查看位置',
    imageFailed: '图片发送失败', imageTooLarge: '图片不能超过 5MB', locationFailed: '无法获取当前位置，请检查定位权限',
  },
  vi: {
    image: 'Ảnh', location: 'Vị trí', openLocation: 'Xem vị trí',
    imageFailed: 'Gửi ảnh thất bại', imageTooLarge: 'Ảnh không được vượt quá 5MB', locationFailed: 'Không lấy được vị trí. Hãy kiểm tra quyền định vị',
  },
  en: {
    image: 'Photo', location: 'Location', openLocation: 'View location',
    imageFailed: 'Photo could not be sent', imageTooLarge: 'Photo must be under 5MB', locationFailed: 'Location unavailable. Check location permission',
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

export function getChatLocation(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    uni.getLocation({
      type: 'gcj02',
      success(result) { resolve({ latitude: result.latitude, longitude: result.longitude }); },
      fail(error) { reject(new Error(error.errMsg || 'Location unavailable')); },
    });
  });
}

export function previewChatImage(mediaUrl: string) {
  const url = resolveMediaUrl(mediaUrl);
  if (url) uni.previewImage({ current: url, urls: [url] });
}

export function openChatLocation(latitude?: number | null, longitude?: number | null) {
  if (latitude == null || longitude == null) return;
  uni.openLocation({ latitude, longitude, scale: 16 });
}
