const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (
  import.meta.env.PROD
    ? 'https://api.huayueyouxuan.com/api/v1'
    : 'http://localhost:3001/api/v1'
);

export function resolveMediaUrl(url?: string) {
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) {
    return url;
  }
  const normalized = url.startsWith('/') ? url : `/${url}`;
  return `${API_BASE_URL.replace(/\/+$/, '')}${normalized}`;
}
