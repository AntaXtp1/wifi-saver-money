// KV helper. Single-user mode: kunci konstan.
// Pakai @vercel/kv (otomatis pakai env KV_REST_API_URL & KV_REST_API_TOKEN).

import { kv } from '@vercel/kv';

const K = {
  schedule: 'wifiSaver:schedule',         // { enabled, slots, tz, tzOffsetMinutes }
  subscription: 'wifiSaver:subscription', // PushSubscription JSON
  fired: 'wifiSaver:fired'                // { 'YYYY-M-D::slotId': lastFiredIdx, ts }
};

export async function getSchedule() {
  return (await kv.get(K.schedule)) || null;
}
export async function setSchedule(value) {
  return kv.set(K.schedule, value);
}

export async function getSubscription() {
  return (await kv.get(K.subscription)) || null;
}
export async function setSubscription(sub) {
  return kv.set(K.subscription, sub);
}
export async function deleteSubscription() {
  return kv.del(K.subscription);
}

export async function getFired() {
  return (await kv.get(K.fired)) || {};
}
export async function setFired(value) {
  return kv.set(K.fired, value);
}

export { K };
