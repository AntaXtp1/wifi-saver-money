// POST /api/subscribe  body: PushSubscription JSON
// Single-user mode: simpan satu subscription di KV.

import { setSubscription, deleteSubscription } from './_lib/kv.js';

export default async function handler(req, res) {
  if (req.method === 'DELETE') {
    await deleteSubscription();
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || !body.endpoint || !body.keys) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    await setSubscription(body);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
}
