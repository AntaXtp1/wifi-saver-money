// GET /api/vapid-public  → returns the VAPID public key as plain text.
// Frontend calls this once before subscribing to push.

export default function handler(req, res) {
  const pub = process.env.VAPID_PUBLIC_KEY;
  if (!pub) {
    return res.status(500).send('VAPID_PUBLIC_KEY not configured');
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(pub);
}
