var CACHE_VERSION = 'v36';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) { return name !== CACHE_VERSION; })
             .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      return self.clients.matchAll({ type: 'window' });
    }).then(function(clients) {
      clients.forEach(function(client) {
        client.postMessage({ type: 'SW_UPDATED' });
      });
    })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(function(response) {
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});

self.addEventListener('push', function(event) {
  var data = { title: 'رسالة جديدة', body: '' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch(e) {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      var targetUrl = data.url || '/';
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].visibilityState === 'visible' && clientList[i].url.indexOf(targetUrl) !== -1) {
          return;
        }
      }
      return self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icon-192.svg',
        badge: '/icon-192.svg',
        dir: 'rtl',
        lang: 'ar',
        vibrate: [200, 100, 200],
        tag: 'chat-' + (data.title || 'msg'),
        renotify: true,
        requireInteraction: false,
        actions: [
          { action: 'open', title: 'فتح' },
          { action: 'dismiss', title: 'تجاهل' }
        ],
        data: { url: data.url || '/' }
      });
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  var targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(self.location.origin) !== -1 && 'navigate' in client) {
          return client.navigate(targetUrl).then(function(c) { return c.focus(); });
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
