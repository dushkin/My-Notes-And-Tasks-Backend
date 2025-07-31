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
  const data = notification.data || {};

  console.log('🖱️ Notification clicked:', { action, tag: notification.tag, data });

  event.notification.close();

  // Handle reminder-specific actions
  if (data.type === 'reminder') {
    event.waitUntil(handleReminderAction(action, data));
    return;
  }

  // Handle other notifications
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

// Handle reminder notification actions
async function handleReminderAction(action, data) {
  const { itemId, itemTitle, reminderData } = data;
  
  console.log(`🔔 SW: Handling reminder action '${action}' for ${itemTitle}`);
  
  // Get app clients
  const clients = await self.clients.matchAll({ type: 'window' });
  
  switch (action) {
    case 'done':
      // Notify app to mark task as done
      clients.forEach(client => {
        client.postMessage({
          type: 'REMINDER_DONE',
          itemId,
          reminderId: `${itemId}-${Date.now()}`
        });
      });
      break;
      
    case 'snooze':
      // Snooze for 5 minutes
      const snoozeTime = Date.now() + 5 * 60 * 1000;
      scheduleReminder({
        itemId,
        timestamp: snoozeTime,
        itemTitle,
        reminderData
      });
      
      // Notify app about snooze
      clients.forEach(client => {
        client.postMessage({
          type: 'REMINDER_SNOOZED',
          itemId,
          snoozeUntil: snoozeTime
        });
      });
      
      // Show snooze confirmation
      await self.registration.showNotification('⏰ Reminder Snoozed', {
        body: `${itemTitle} will remind you again in 5 minutes`,
        icon: '/favicon-192x192.png',
        tag: `snooze-${itemId}`,
        requireInteraction: false,
        silent: true
      });
      break;
      
    case 'dismiss':
      // Just dismiss - notify app to clear reminder
      clients.forEach(client => {
        client.postMessage({
          type: 'REMINDER_DISMISSED',
          itemId
        });
      });
      break;
      
    case 'open':
    default:
      // Open or focus the app
      let appFocused = false;
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          appFocused = true;
          break;
        }
      }
      
      if (!appFocused) {
        await self.clients.openWindow('/');
      }
      
      // Notify app to focus the specific item
      const allClients = await self.clients.matchAll({ type: 'window' });
      allClients.forEach(client => {
        client.postMessage({
          type: 'FOCUS_ITEM',
          itemId
        });
      });
      break;
  }
}

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

// Reminder scheduling storage
let scheduledReminders = new Map();

// Message handling from main thread
self.addEventListener('message', (event) => {
  console.log('💬 Message received:', event.data);
  
  const { type, data } = event.data || {};
  
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'SCHEDULE_REMINDER') {
    scheduleReminder(data);
  } else if (type === 'CANCEL_REMINDER') {
    cancelReminder(data.itemId);
  }
});

// Schedule a reminder in the service worker
function scheduleReminder({ itemId, timestamp, itemTitle, reminderData }) {
  // Cancel any existing reminder for this item
  cancelReminder(itemId);
  
  const delay = timestamp - Date.now();
  console.log(`📅 SW: Scheduling reminder for ${itemTitle} in ${delay}ms`);
  
  if (delay <= 0) {
    // Show immediately
    showReminderNotification(itemId, itemTitle, reminderData);
    return;
  }
  
  // Schedule for later
  const timeoutId = setTimeout(() => {
    showReminderNotification(itemId, itemTitle, reminderData);
    scheduledReminders.delete(itemId);
  }, delay);
  
  scheduledReminders.set(itemId, timeoutId);
}

// Cancel a scheduled reminder
function cancelReminder(itemId) {
  if (scheduledReminders.has(itemId)) {
    clearTimeout(scheduledReminders.get(itemId));
    scheduledReminders.delete(itemId);
    console.log(`❌ SW: Cancelled reminder for ${itemId}`);
  }
}

// Show reminder notification
async function showReminderNotification(itemId, itemTitle, reminderData = {}) {
  console.log('🔔 SW: Showing reminder notification for:', itemTitle);
  
  const title = '⏰ Reminder';
  const body = `Don't forget: ${itemTitle || 'Untitled'}`;
  const options = {
    body,
    icon: '/favicon-192x192.png',
    badge: '/favicon-48x48.png',
    tag: `reminder-${itemId}`,
    requireInteraction: true,
    silent: false,
    vibrate: [800, 200, 800, 200, 800],
    data: {
      type: 'reminder',
      itemId,
      itemTitle,
      reminderData
    },
    actions: reminderData.reminderDisplayDoneButton ? [
      { action: 'done', title: '✅ Mark Done' },
      { action: 'snooze', title: '⏰ Snooze 5min' },
      { action: 'open', title: '📱 Open App' }
    ] : [
      { action: 'snooze', title: '⏰ Snooze 5min' },
      { action: 'open', title: '📱 Open App' },
      { action: 'dismiss', title: '❌ Dismiss' }
    ]
  };
  
  try {
    await self.registration.showNotification(title, options);
    console.log('✅ SW: Reminder notification displayed');
    
    // Notify main thread that reminder was triggered
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'REMINDER_TRIGGERED',
        itemId,
        itemTitle,
        reminderData
      });
    });
  } catch (error) {
    console.error('❌ SW: Failed to show reminder notification:', error);
  }
}

console.log('🚀 Service Worker script loaded successfully');