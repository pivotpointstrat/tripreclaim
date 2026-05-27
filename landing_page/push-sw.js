/* TripReclaim Push Notification Service Worker */

self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { title: 'TripReclaim', body: event.data.text() }; }

  const options = {
    body:    data.body  || 'Price drop detected on your flight.',
    icon:    data.icon  || '/logos/favicon.png',
    badge:   data.badge || '/logos/favicon.png',
    tag:     'tripreclaim-alert',
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || 'https://tripreclaim.com/dashboard/' },
    actions: [
      { action: 'view', title: 'View Details' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'TripReclaim', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || 'https://tripreclaim.com/dashboard/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('tripreclaim.com') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
