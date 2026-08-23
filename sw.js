// ██████████████████████████████████████
// ארנק חכם — Service Worker v2
// Cache-first PWA + Background Sync
// ██████████████████████████████████████

const CACHE_NAME = 'wallet-v4';
const OFFLINE_DATA_KEY = 'wallet-offline-queue';

// Files to cache for full offline support
const APP_SHELL = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=Fredoka+One&family=Rubik:wght@400;500;600;700&display=swap',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js',
];

// ── INSTALL: cache app shell ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache index.html and fonts — Firebase SDK too big to cache fully
      return cache.addAll(['./', './index.html']).catch(()=>{});
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: smart cache strategy ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ⚡ CRITICAL: Never intercept the actual Firestore LIVE connection.
  // onSnapshot() uses a persistent streaming channel — wrapping it in
  // respondWith() breaks the stream and forces constant reconnects.
  // This is the domain that carries realtime data (reads/writes/listeners):
  if(url.hostname.includes('firestore.googleapis.com')){
    return; // bypass SW completely — straight to network
  }

  // Only GET requests are cacheable
  if(e.request.method !== 'GET') return;

  // ⚡ Firebase SDK files (gstatic.com/firebasejs/10.12.0/...) are
  // versioned & immutable — safe (and FAST) to cache-first. This is
  // the part that was slow before: the ~2 SDK module files had to be
  // re-downloaded on every single app open. Now they load instantly
  // from cache after the first visit.
  if(url.hostname.includes('gstatic.com') || url.hostname.includes('fonts.googleapis.com')){
    e.respondWith(
      caches.match(e.request).then(cached => {
        if(cached) return cached;
        return fetch(e.request).then(response => {
          if(response && response.status === 200){
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // App shell (index.html itself) — Cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(response => {
        if(response && response.status === 200 && response.type !== 'opaque'){
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        if(e.request.mode === 'navigate'){
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ── PUSH notifications ──
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || '💰 ארנק חכם', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      dir: 'rtl', lang: 'he',
      tag: data.tag || 'wallet',
      renotify: true,
      data: {url: './'}
    })
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
      for(const client of list){
        if(client.url.includes('index') && 'focus' in client) return client.focus();
      }
      return clients.openWindow('./');
    })
  );
});

// ── BACKGROUND SYNC (when connection restored) ──
self.addEventListener('sync', e => {
  if(e.tag === 'wallet-sync'){
    e.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({type:'SYNC_NOW'}));
      })
    );
  }
});

// ── MESSAGE from app ──
self.addEventListener('message', e => {
  if(e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
