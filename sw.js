const CACHE_NAME = 'dpd-stopy-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './assets/icon.svg',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Instalacja Service Workera i cache'owanie zasobów
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Otwieranie cache');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// Aktywacja i czyszczenie starego cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Usuwanie starego cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Pobieranie zasobów
self.addEventListener('fetch', (event) => {
  // Dla żądań nawigacyjnych (HTML) użyj strategii Network First
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // Dla pozostałych zasobów Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then(
          (networkResponse) => {
            // Cache'uj nowe zasoby
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          }
        ).catch((err) => {
           // Błąd sieci, zwróć cached response jeśli jest, w przeciwnym razie błąd
           // Ale tutaj jesteśmy w .then(cachedResponse), więc jeśli fetch failuje, a nie ma cache, to zwróć błąd
           // Jeśli cachedResponse istnieje, to zostanie zwrócony w następnym kroku (bo fetchPromise to promise)
           console.log('Fetch error:', err);
        });

        // Zwróć cachedResponse od razu jeśli jest, w przeciwnym razie czekaj na fetch
        return cachedResponse || fetchPromise;
      })
  );
});
