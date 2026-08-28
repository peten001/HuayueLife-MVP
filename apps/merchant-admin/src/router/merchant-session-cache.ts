let cachedToken = '';
let cachedSession: unknown = null;
let sessionRequest: Promise<unknown> | null = null;

export function resolveCachedMerchantSession<T>(
  token: string,
  loader: () => Promise<T>,
): Promise<T> {
  if (cachedToken === token && cachedSession) {
    return Promise.resolve(cachedSession as T);
  }
  if (cachedToken === token && sessionRequest) {
    return sessionRequest as Promise<T>;
  }
  cachedToken = token;
  cachedSession = null;
  const request = loader()
    .then((session) => {
      if (cachedToken === token) cachedSession = session;
      return session;
    })
    .finally(() => {
      if (sessionRequest === request) sessionRequest = null;
    });
  sessionRequest = request;
  return request;
}

export function invalidateMerchantSessionCache() {
  cachedToken = '';
  cachedSession = null;
  sessionRequest = null;
}
