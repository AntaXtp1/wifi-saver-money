# WiFi Saver

SPA buat nabung receh tiap hari biar WiFi MyRepublic aman tiap bulan. Dark mode, neon green, gen-z sinis. PWA installable. Reminder notifikasi dua lapis: Service Worker lokal + Web Push lewat GitHub Actions cron.

## Fitur

- Target Rp205.000/bulan, toggle Subsidi Emak (turun ke Rp175.000)
- Input manual + chip cepat (Rp10k / Rp15k / Rp100k)
- Estimasi hari berdasarkan rata-rata aktual
- Status sinis 6 tier sesuai nominal setoran
- Log harian + hapus entri terakhir
- Arsip bulan lunas (permanen)
- Grand total: jumlah bulan, total pengeluaran, rata-rata
- PWA installable
- Reminder dua lapis dengan dedup 10 menit
- Pesan dinamis (urgent / supportif / eskalatif sesuai kondisi)

## Stack

- Frontend: HTML + CSS + Vanilla JS (no build)
- API: Vercel Serverless Functions
- Storage: Vercel KV
- Push: web-push (VAPID)
- Cron: GitHub Actions (`*/10 * * * *`)

## Deploy

Lihat **[CARA-DEPLOY.md](./CARA-DEPLOY.md)** untuk panduan lengkap step-by-step.

## Jalan lokal (frontend doang)

```
npx serve .
```

Reminder lapis 2 (push dari server) tidak tersedia di local. Lapis 1 (SW lokal) jalan.

## Struktur

```
.
├── index.html
├── styles.css
├── app.js
├── sw.js
├── manifest.webmanifest
├── package.json
├── vercel.json
├── CARA-DEPLOY.md
├── api/
│   ├── _lib/kv.js
│   ├── schedule.js
│   ├── subscribe.js
│   ├── tick.js
│   └── vapid-public.js
├── scripts/generate-vapid.js
├── .github/workflows/cron.yml
└── icons/
```

## Catatan

- Single-user (1 push subscription disimpan di KV).
- Data deposit/arsip di LocalStorage browser. Hapus cache = hilang.
- iOS Safari: Web Push butuh PWA di-install ke Home Screen (iOS 16.4+).
