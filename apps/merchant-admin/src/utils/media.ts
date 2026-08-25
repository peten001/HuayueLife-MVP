import { API_BASE_URL } from '@/config/api';

export function resolveMediaUrl(url?: string) {
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) {
    return url;
  }
  const normalized = url.startsWith('/') ? url : `/${url}`;
  return `${API_BASE_URL.replace(/\/+$/, '')}${normalized}`;
}
