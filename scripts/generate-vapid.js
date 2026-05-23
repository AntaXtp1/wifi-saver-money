// Generate VAPID keys: `node scripts/generate-vapid.js`
// Copy output ke Vercel env vars.

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();

console.log('\nVAPID keys generated. Tambah ke Vercel env (Production + Preview + Development):\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('VAPID_SUBJECT=mailto:you@example.com   # ganti pakai email lo\n');
