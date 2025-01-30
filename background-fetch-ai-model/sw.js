/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
  event.waitUntil(
    (async () => {
      if ('navigationPreload' in self.registration) {
        await self.registration.navigationPreload.enable();
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      try {
        const response = await event.preloadResponse;
        if (response) {
          return response;
        }
        return fetch(event.request);
      } catch {
        return new Response('Offline');
      }
    })()
  );
});

self.addEventListener('backgroundfetchsuccess', (event) => {
  const bgFetch = event.registration;

  event.waitUntil(
    (async () => {
      const cache = await caches.open('downloads');
      const records = await bgFetch.matchAll();
      const promises = records.map(async (record) => {
        const response = await record.responseReady;
        await cache.put(record.request, response);
      });
      await Promise.all(promises);
      event.updateUI({ title: 'Model downloaded' });
      self.clients.matchAll().then((clientList) => {
        for (const client of clientList) {
          client.postMessage({
            message: 'download-complete',
            id: bgFetch.id,
          });
        }
      });
    })()
  );
});
