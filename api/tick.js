// POST /api/tick (auth: x-cron-secret header)
// Dipanggil GitHub Actions tiap 10 menit. Cek slot yg harusnya fire sekarang,
// kirim Web Push, update fired log untuk dedup harian.

import webpush from 'web-push';
import {
  getSchedule,
  getSubscription,
  deleteSubscription,
  getFired,
  setFired
} from './_lib/kv.js';

const TICK_WINDOW_MS = 10 * 60 * 1000;     // window cocok dgn cron */10
const DEDUP_WINDOW_MS = 10 * 60 * 1000;    // jangan kirim push 2x dalam 10 menit

function configureVapid() {
  const subject = process.env.VAPID_SUBJECT || 'mailto:wifi-saver@example.com';
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error('VAPID env vars missing');
  webpush.setVapidDetails(subject, pub, priv);
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function dayKeyForUser(now, tzOffsetMinutes) {
  // tzOffsetMinutes = -getTimezoneOffset() user (mis: WIB = +420)
  const userMs = now.getTime() + tzOffsetMinutes * 60 * 1000;
  const u = new Date(userMs);
  return `${u.getUTCFullYear()}-${u.getUTCMonth() + 1}-${u.getUTCDate()}`;
}

function nowInUserTime(now, tzOffsetMinutes) {
  // returns { hour, minute, ms (since user's midnight) }
  const userMs = now.getTime() + tzOffsetMinutes * 60 * 1000;
  const u = new Date(userMs);
  const hour = u.getUTCHours();
  const minute = u.getUTCMinutes();
  const second = u.getUTCSeconds();
  const sinceMidnight = ((hour * 60 + minute) * 60 + second) * 1000;
  return { hour, minute, sinceMidnight };
}

const REMINDER_MESSAGES = [
  ['Setor sekarang biar WiFi aman bulan ini.', 'Belum nabung hari ini? Receh juga gapapa.', 'WiFi nggak bayar sendiri, bro.'],
  ['Notif kedua. Beneran belum nabung?', 'Lo skip notif pertama. Babak kedua.', 'Tetangga lagi siap-siap ganti password.'],
  ['Final reminder. Habis ini gue diem.', 'Reminder terakhir. Tabunganmu nggak nambah sendiri.'],
  ['Lewat tiga notif tetep skip. Respect dulu sama diri sendiri.'],
  ['Lo dan gue sama-sama tau ini udah berlebihan.'],
  ['Ke-enam. Beneran udah, deh.']
];
function pickMessage(attempt) {
  const tier = REMINDER_MESSAGES[Math.min(attempt, REMINDER_MESSAGES.length - 1)];
  return tier[Math.floor(Math.random() * tier.length)];
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: header x-cron-secret harus cocok env CRON_SECRET
  const expected = process.env.CRON_SECRET;
  const got = req.headers['x-cron-secret'] || req.query?.secret;
  if (!expected || got !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    configureVapid();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const schedule = await getSchedule();
  const subscription = await getSubscription();

  if (!schedule || !schedule.enabled || !Array.isArray(schedule.slots) || schedule.slots.length === 0) {
    return res.status(200).json({ ok: true, skipped: 'schedule disabled or empty' });
  }
  if (!subscription) {
    return res.status(200).json({ ok: true, skipped: 'no subscription' });
  }

  const now = new Date();
  const tzOffsetMinutes = Number.isFinite(schedule.tzOffsetMinutes) ? schedule.tzOffsetMinutes : 420;
  const dayKey = dayKeyForUser(now, tzOffsetMinutes);
  const userNow = nowInUserTime(now, tzOffsetMinutes);

  const fired = await getFired();

  // prune old day keys
  for (const k of Object.keys(fired)) {
    if (!k.startsWith(dayKey + '::') && !k.startsWith('__')) {
      delete fired[k];
    }
  }

  // global dedup (across slots)
  const lastGlobalAt = fired.__lastFiredAt || 0;
  if (now.getTime() - lastGlobalAt < DEDUP_WINDOW_MS) {
    await setFired(fired);
    return res.status(200).json({ ok: true, skipped: 'dedup global window' });
  }

  let pushed = 0;
  let errors = [];

  for (const slot of schedule.slots) {
    const [h, m] = (slot.time || '19:00').split(':').map(n => parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const slotStartMs = ((h * 60 + m) * 60) * 1000;          // since user's midnight
    const intervalMs = clamp(slot.intervalMin, 1, 60) * 60 * 1000;
    const count = clamp(slot.count, 1, 10);
    const elapsed = userNow.sinceMidnight - slotStartMs;
    if (elapsed < 0) continue;

    // attempt index yg harusnya udah lewat
    const dueIdx = Math.min(count - 1, Math.floor(elapsed / intervalMs));
    const firedKey = `${dayKey}::${slot.id}`;
    const lastFiredIdx = (typeof fired[firedKey] === 'number') ? fired[firedKey] : -1;

    // cari attempt terkecil yg belum di-fire
    for (let i = lastFiredIdx + 1; i <= dueIdx; i++) {
      const targetMs = slotStartMs + i * intervalMs;
      const lateMs = userNow.sinceMidnight - targetMs;
      // jangan fire kalau attempt-nya udah terlalu basi (> tick window)
      if (lateMs > TICK_WINDOW_MS) continue;

      const payload = JSON.stringify({
        title: i > 0 ? `WiFi Saver · pengingat ${i + 1}` : 'WiFi Saver',
        body: pickMessage(i),
        key: `${firedKey}::${i}`,
        tag: `wifi-saver-push-${i}`
      });

      try {
        await webpush.sendNotification(subscription, payload, { TTL: 60 });
        fired[firedKey] = i;
        fired.__lastFiredAt = now.getTime();
        pushed += 1;
        // 1 push per tick utk hindari burst (cron berikutnya akan ambil sisanya)
        break;
      } catch (err) {
        errors.push(String(err?.statusCode || err?.message));
        // 410/404 = subscription expired → hapus
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await deleteSubscription();
        }
        break;
      }
    }
    if (pushed > 0) break; // cuma 1 push per tick total
  }

  await setFired(fired);
  res.status(200).json({ ok: true, pushed, errors, dayKey, hour: userNow.hour, minute: userNow.minute });
}
