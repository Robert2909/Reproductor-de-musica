// Service Worker para soporte de PWA e instalación en escritorio
const CACHE_NAME = 'music-player-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Pass through fetch to support local audio blobs and Vite HMR
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
