// Service Worker para soporte de PWA e instalación en escritorio
const CACHE_NAME = 'music-player-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Manejo nativo de peticiones para permitir streaming de blobs y peticiones a GitHub Pages
});
