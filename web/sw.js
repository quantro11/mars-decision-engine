// Offline Cache-First Service Worker for Martiap (Planetary Layers & Core UI)
(function (sw) {
  'use strict';
  const CACHE_NAME = 'mde-planetary-cache-v3';
  const CORE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './layers/meta.js',
    './caves.js',
    './planet_profiles.js',
    './scoring.js',
    './regions.js',
    './astar.js',
    './storm.js',
    './globe3d.js',
    './live_api.js',
    './ui/format.js',
    './ui/charts.js',
    './ui/markers.js',
    './ui/overlays.js',
    './ui/layers.js',
    './ui/i18n.js',
    './ui/eva_zones.js',
    './ui/eva_sim.js',
    './ui/eva_render.js',
    './ui/eva.js',
    './ui/panels.js',
    './ui/landing_site.js',
    './ui/map2d.js',
    './ui/habitability.js',
    './ui/brief.js',
    './app.js',
    './worker.js',
    './layers/elev.png',
    './layers/slope.png',
    './layers/rough.png',
    './layers/ice01.png',
    './layers/ice15.png',
    './layers/ice5.png',
    './layers/ti.png',
    './layers/dust.png',
    './layers/cave.png',
    './layers/basemap.png'
  ];

  sw.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => sw.skipWaiting())
    );
  });

  sw.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ).then(() => sw.clients.claim())
    );
  });

  sw.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== sw.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;

    event.respondWith(
      caches.match(req).then((cached) => {
        const netFetch = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || netFetch;
      })
    );
  });
})(self);
