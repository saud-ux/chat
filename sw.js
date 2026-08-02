var CACHE_VERSION = 'v38';

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

function normalizePath(p) {
  var s = (p || '/').replace(/\/+$/, '');
  return s || '/';
}

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

      if (data.type === 'call') {
        return self.registration.showNotification('📞 مكالمة واردة', {
          body: data.body,
          icon: '/icon-192.svg',
          badge: '/icon-192.svg',
          dir: 'rtl',
          lang: 'ar',
          tag: 'incoming-call',
          renotify: true,
          requireInteraction: true,
          vibrate: [1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000],
          silent: false,
          actions: [
            { action: 'answer', title: '📞 رد' },
            { action: 'reject', title: '❌ رفض' }
          ],
          data: { url: data.url || '/', type: 'call', callId: data.callId || '' }
        });
      }

      if (data.type === 'alert') {
        return self.registration.showNotification('🚨 تنبيه طارئ!', {
          body: data.body,
          icon: '/icon-192.svg',
          badge: '/icon-192.svg',
          dir: 'rtl',
          lang: 'ar',
          tag: 'emergency-alert',
          renotify: true,
          requireInteraction: true,
          vibrate: [500, 200, 500, 200, 500, 200, 500, 200, 500, 200, 500, 200, 500],
          silent: false,
          actions: [
            { action: 'open', title: '🚨 افتح الآن' }
          ],
          data: { url: data.url || '/', type: 'alert' }
        });
      }

      var targetUrl = data.url || '/';
      var targetPath;
      try { targetPath = normalizePath(new URL(targetUrl, self.location.origin).pathname); }
      catch(e) { targetPath = normalizePath(targetUrl); }

      if (targetPath !== '/') {
        for (var i = 0; i < clientList.length; i++) {
          if (clientList[i].visibilityState === 'visible') {
            var cp;
            try { cp = normalizePath(new URL(clientList[i].url).pathname); }
            catch(e) { cp = ''; }
            if (cp === targetPath) return;
          }
        }
      }

      var tag = 'msg-' + (data.msgId || (Date.now() + '-' + Math.random().toString(36).slice(2, 8)));

      return self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icon-192.svg',
        badge: '/icon-192.svg',
        dir: 'rtl',
        lang: 'ar',
        vibrate: [200, 100, 200],
        tag: tag,
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

  var notifData = event.notification.data || {};

  if (event.action === 'reject' && notifData.callId) {
    event.waitUntil(
      fetch('https://chat-app-75b2a-default-rtdb.firebaseio.com/calls/' + notifData.callId + '/status.json', {
        method: 'PUT',
        body: JSON.stringify('rejected'),
        headers: { 'Content-Type': 'application/json' }
      })
    );
    return;
  }

  var targetUrl = notifData.url || '/';

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
