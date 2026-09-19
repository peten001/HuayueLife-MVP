/* Cashier push worker intentionally does not intercept fetch or cache API data. */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const path = typeof payload.path === 'string' && /^\/(pickup|delivery)\/\d+$/.test(payload.path)
    ? payload.path : '/tables';
  event.waitUntil(self.registration.showNotification(
    typeof payload.title === 'string' ? payload.title : 'YunQiao · 新订单',
    {
      body: typeof payload.body === 'string' ? payload.body : '请及时处理新订单',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      tag: typeof payload.tag === 'string' ? payload.tag : 'cashier-new-order',
      renotify: true,
      data: { path },
    },
  ));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.path || '/tables';
  const url = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(url);
      return existing.focus();
    }
    return self.clients.openWindow(url);
  })());
});
