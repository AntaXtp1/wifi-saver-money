// Upstash Redis client (REST). Single-user mode: kunci konstan.
// Vercel Marketplace → Upstash integration auto-inject:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// Catatan: kalau env-nya pakai prefix lain (KV_REST_API_URL/KV_REST_API_TOKEN
// dari integrasi lama), kita fallback otomatis.

import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  console.warn('[kv] Upstash env vars belum di-set. /api endpoints akan gagal.');
}

const redis = new Redis({ url, token });

const K = {
  schedule: 'wifiSaver:schedule',         // { enabled, slots, tz, tzOffsetMinutes }
  subscription: 'wifiSaver:subscription', // PushSubscription JSON
  fired: 'wifiSaver:fired'                // { 'YYYY-M-D::slotId': lastFiredIdx, __lastFiredAt }
};

// Upstash REST client otomatis JSON-serialize/deserialize.
export async function getSchedule() {
  return (await redis.get(K.schedule)) || null;
}
export async function setSchedule(value) {
  return redis.set(K.schedule, value);
}

export async function getSubscription() {
  return (await redis.get(K.subscription)) || null;
}
export async function setSubscription(sub) {
  return redis.set(K.subscription, sub);
}
export async function deleteSubscription() {
  return redis.del(K.subscription);
}

export async function getFired() {
  return (await redis.get(K.fired)) || {};
}
export async function setFired(value) {
  return redis.set(K.fired, value);
}

export { K, redis };
