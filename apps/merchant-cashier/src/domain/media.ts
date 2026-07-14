import { cashierConfig } from '@/config';

export function resolveMediaUrl(value?: string | null) {
  const source = value?.trim();
  if (!source) return '';
  if (/^https:\/\//i.test(source) || source.startsWith('data:image/')) return source;
  if (/^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')) return '';
  const normalized = source.startsWith('/') ? source : `/${source}`;
  return `${cashierConfig.apiBaseUrl}${normalized}`;
}
