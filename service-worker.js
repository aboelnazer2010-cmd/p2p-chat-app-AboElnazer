const CACHE_NAME = 'p2p-nexus-v1';

// Cache all major local UI assets and the remote PeerJS component
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache. Caching initial assets.');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Serve from cache if available, otherwise fetch from internet
                return response || fetch(event.request);
            }).catch(() => {
                // Basic offline fallback (if we didn't cache the page) 
                // In a PWA, since we cached `index.html`, it covers the offline state.
            })
    );
});
