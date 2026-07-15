import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const DEVELOPMENT_ORIGINS = [
  'http://localhost:4173',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5176',
];

const PRODUCTION_DEFAULT_ORIGINS = [
  'https://admin.huayueyouxuan.com',
  'https://servicewechat.com',
];

export function createCorsOptions(
  nodeEnv: string | undefined,
  configuredOrigins: string | undefined,
): CorsOptions {
  const production = nodeEnv === 'production';
  const defaults = production
    ? PRODUCTION_DEFAULT_ORIGINS
    : [...PRODUCTION_DEFAULT_ORIGINS, ...DEVELOPMENT_ORIGINS];
  const configured = configuredOrigins
    ? configuredOrigins
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => validateOrigin(item, production))
    : [];
  const allowed = new Set([...defaults, ...configured]);

  return {
    credentials: true,
    origin(origin, callback) {
      // Native clients, server-to-server calls, and same-origin requests do not
      // send an Origin header. Browser origins must match the exact allowlist.
      if (!origin || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin is not allowed'), false);
    },
  };
}

function validateOrigin(value: string, production: boolean) {
  if (value === '*' || value.includes('*')) {
    throw new Error('CORS_ALLOWED_ORIGINS does not support wildcards');
  }
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Invalid exact CORS origin: ${value}`);
  }
  if (production && url.protocol !== 'https:') {
    throw new Error(`Production CORS origin must use HTTPS: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported CORS origin protocol: ${value}`);
  }
  return url.origin;
}
