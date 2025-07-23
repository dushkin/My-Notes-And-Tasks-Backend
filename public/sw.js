const CACHE_NAME = 'notask-pwa-v1.0.0';
const STATIC_CACHE_URLS = [
  '/',
  '/pwa-test.html'
];

// Install event - cache static resources
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('💾 Caching static resources');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => {
        console.log('✅ Service Worker installed');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker activated');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and browser requests
  if (event.request.url.startsWith('chrome-extension://') || 
      event.request.url.startsWith('moz-extension://')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version if available
        if (response) {
          console.log('📱 Serving from cache:', event.request.url);
          return response;
        }
        
        // For navigation requests, try network first
        if (event.request.mode === 'navigate') {
          return fetch(event.request)
            .then(response => {
              // Cache successful responses
              if (response.status === 200) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(event.request, responseClone));
              }
              return response;
            })
            .catch(() => {
              // Return cached page for offline navigation
              return caches.match('/pwa-test.html') || caches.match('/');
            });
        }
        
        // For other requests, try network first
        return fetch(event.request)
          .catch(() => {
            console.log('📡 Network failed, checking cache for:', event.request.url);
            return caches.match(event.request);
          });
      })
  );
});

// Push notification handling
self.addEventListener('push', function (event) {
  console.log('📬 Push notification received:', event);
  
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      console.error('❌ Failed to parse push data:', e);
      data = { title: 'Notification', body: 'You have a new notification' };
    }
  }

  const title = data.title || "📱 NoTask Notification";
  const options = {
    body: data.body || "You have a new notification",
    icon: data.icon || '/favicon-192x192.png',
    badge: data.badge || '/favicon-48x48.png',
    tag: data.tag || `notification-${Date.now()}`,
    data: data.data || data,
    requireInteraction: false,
    silent: false,
    actions: [
      { action: "open", title: "📱 Open App" },
      { action: "dismiss", title: "❌ Dismiss" }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => {
        console.log('✅ Push notification displayed');
      })
      .catch(error => {
        console.error('❌ Failed to display notification:', error);
      })
  );
});

// Notification click handling
self.addEventListener('notificationclick', function (event) {
  const action = event.action;
  const notification = event.notification;

  console.log('🖱️ Notification clicked:', { action, tag: notification.tag });

  event.notification.close();

  if (action === 'dismiss') {
    return; // Just close the notification
  }

  // Open or focus the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Check if app is already open
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            return client.focus();
          }
        }
        // Open new window if app is not open
        return self.clients.openWindow('/pwa-test.html');
      })
  );
});

// Background sync (for future use)
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync triggered:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Add background sync logic here
      console.log('🔄 Background sync completed')
    );
  }
});

// Message handling from main thread
self.addEventListener('message', (event) => {
  console.log('💬 Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('🚀 Service Worker script loaded successfully');