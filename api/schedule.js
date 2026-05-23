// GET  /api/schedule → current schedule
// POST /api/schedule body: { enabled, slots, tz, tzOffsetMinutes, subscription? }
// Single-user mode.

import { setSchedule, getSchedule, setSubscription } from './_lib/kv.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const data = await getSchedule();
    return res.status(200).json(data || { enabled: false, slots: [] });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid body' });
    }

    const slots = Array.isArray(body.slots) ? body.slots.map(s => ({
      id: String(s.id || '').slice(0, 32),
      time: typeof s.time === 'string' ? s.time : '19:00',
      count: clamp(parseInt(s.count, 10) || 1, 1, 10),
      intervalMin: clamp(parseInt(s.intervalMin, 10) || 10, 1, 60)
    })) : [];

    const value = {
      enabled: !!body.enabled,
      slots,
      tz: typeof body.tz === 'string' ? body.tz : 'Asia/Jakarta',
      tzOffsetMinutes: Number.isFinite(body.tzOffsetMinutes) ? body.tzOffsetMinutes : 420,
      updatedAt: Date.now()
    };
    await setSchedule(value);

    if (body.subscription && body.subscription.endpoint) {
      await setSubscription(body.subscription);
    }

    res.status(200).json({ ok: true, value });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save schedule' });
  }
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
