const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api/v1';

export function resolveMediaUrl(url?: string) {
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) {
    return url;
  }
  const normalized = url.startsWith('/') ? url : `/${url}`;
  return `${API_BASE_URL.replace(/\/+$/, '')}${normalized}`;
}

export function mediaImageCandidates(url: string | undefined, variant: 'original' | 'card' = 'original') {
  const original = resolveMediaUrl(url);
  if (!original) return [];
  const previewManaged = import.meta.env.MODE === 'explore-preview'
    && /^http:\/\/(?:localhost|127\.0\.0\.1):4200\/__(?:production|local)\/api\/v1\/uploads\/merchants\//.test(original);
  const managed = !/^(https?:)?\/\//i.test(url || '') || original.startsWith(`${API_BASE_URL.replace(/\/+$/, '')}/`) || previewManaged;
  if (variant === 'card' && managed && /\/uploads\/merchants\/merchant-[a-f0-9]{24}-display-v1-1440\.webp(?:[?#].*)?$/.test(original)) {
    return [original.replace(/-display-v1-1440\.webp(?=[?#]|$)/, '-card-v1-480.webp'), original];
  }
  return [original];
}
