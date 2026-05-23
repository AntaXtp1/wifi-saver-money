/* WiFi Saver — service worker
   Strategi:
   - precache shell utama
   - network-first untuk index.html (biar update kebawa)
   - cache-first untuk asset statik
   - menerima notif (showNotification) dipakai dari halaman via reg.showNotification
   - schedule reminder via postMessage → SW setTimeout
   - dedup window 10 menit pakai timestamp di SW state
*/

const CACHE = 'wifi-saver-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Hanya tangani same-origin
  if (url.origin !== self.location.origin) return;

  // Network-first untuk dokumen/HTML
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first untuk asset statik
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});

// Notif click → fokus / buka app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./index.html');
  })());
});

// =========================================================
// Reminder scheduling inside SW
// =========================================================
// Limitasi yang harus dipahami:
// - SW dapat di-terminate browser saat idle (biasanya 30s - beberapa menit
//   setelah event terakhir). setTimeout dengan delay > beberapa menit TIDAK
//   selalu akan eksekusi.
// - Jadi SW scheduling cocok untuk slot yg jam-nya dekat dgn waktu user buka
//   app. Untuk slot yg jauh, perlu Web Push (server-side).
//
// State (in-memory di SW worker):
const SW_STATE = {
  timers: new Map(),       // key: notifKey → timeoutId
  lastFiredAt: 0,          // timestamp ms; dipakai untuk dedup 10 menit
  lastFiredKey: null
};
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'SCHEDULE_REMINDERS') {
    rescheduleAll(data.payload || []);
  } else if (data.type === 'CANCEL_REMINDERS') {
    cancelAll();
  } else if (data.type === 'FIRE_NOW') {
    // dipanggil saat halaman ngedeteksi attempt yg "telat tapi masih dalam grace"
    showReminder(data.payload).catch(() => {});
  }
});

function cancelAll() {
  for (const id of SW_STATE.timers.values()) clearTimeout(id);
  SW_STATE.timers.clear();
}

function rescheduleAll(items) {
  cancelAll();
  // items: [{ key, title, body, fireAt (ms epoch), data }]
  const now = Date.now();
  for (const it of items) {
    const delay = it.fireAt - now;
    if (delay <= 0) continue;            // already past, biarkan halaman yg fire (grace logic)
    if (delay > 6 * 60 * 60 * 1000) continue; // > 6 jam, nggak reliable di SW
    const id = setTimeout(() => {
      showReminder(it).catch(() => {});
      SW_STATE.timers.delete(it.key);
    }, delay);
    SW_STATE.timers.set(it.key, id);
  }
}

async function showReminder(item) {
  if (!item) return;
  // dedup 10 menit
  const now = Date.now();
  if (now - SW_STATE.lastFiredAt < DEDUP_WINDOW_MS && SW_STATE.lastFiredKey !== item.key) {
    // duplikat dari sumber lain (push) baru aja fire — skip kecuali item ini yang sama
    return;
  }
  await self.registration.showNotification(item.title || 'WiFi Saver', {
    body: item.body || '',
    icon: 'icons/icon-192.svg',
    badge: 'icons/icon-192.svg',
    tag: item.tag || `wifi-saver-${item.key || 'reminder'}`,
    renotify: true,
    data: item.data || {}
  });
  SW_STATE.lastFiredAt = now;
  SW_STATE.lastFiredKey = item.key || null;
}

// Web Push (lapis 2: dipicu Vercel cron) — handler ini siap walau lapis 2 belum dipasang.
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (_) { payload = { body: e.data && e.data.text() }; }
  e.waitUntil(showReminder({
    key: payload.key || `push-${Date.now()}`,
    title: payload.title || 'WiFi Saver',
    body: payload.body || 'Pengingat nabung.',
    tag: payload.tag,
    data: payload.data
  }));
});
