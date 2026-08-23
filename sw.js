// ██████████████████████████████████████
// ארנק חכם — Service Worker v2
// Cache-first PWA + Background Sync
// ██████████████████████████████████████

const CACHE_NAME = 'wallet-v3';
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

  // ⚡ CRITICAL FIX: Never intercept Firebase/Firestore/Google requests.
  // Firestore's onSnapshot() uses a persistent streaming connection
  // (WebChannel) — if the Service Worker wraps it in respondWith(),
  // the stream gets proxied through the SW, breaks, and reconnects
  // constantly. This was the cause of the slow loading.
  // By not calling e.respondWith() at all, these requests bypass the
  // SW entirely and go straight to the network, exactly like without a SW.
  if(url.hostname.includes('firestore.googleapis.com') ||
     url.hostname.includes('googleapis.com') ||
     url.hostname.includes('firebaseio.com') ||
     url.hostname.includes('firebase') ||
     url.hostname.includes('gstatic.com') ||
     url.hostname.includes('google.com')){
    return; // let the browser handle it natively — no interception
  }

  // Only GET requests are safe to cache
  if(e.request.method !== 'GET') return;

  // App shell (HTML, fonts, scripts) — Cache first, then network
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
