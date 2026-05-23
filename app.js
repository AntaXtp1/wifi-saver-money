/* =========================================================
   WiFi Saver — app logic
   - LocalStorage persistence
   - Subsidi Emak toggle
   - Quick deposits + manual input with validation
   - Status messages (5+ tier)
   - Daily log + undo last
   - Finish month → archive + reset
   - Grand total
   - PWA install + reminder notifications
   ========================================================= */

(() => {
  'use strict';

  // ---------- CONSTANTS ----------
  const STORAGE_KEY = 'wifiSaver.v1';
  const TARGET_FULL = 205000;
  const TARGET_SUBSIDY = 175000;   // emak subsidi 30k
  const MIN_DEPOSIT = 1000;
  const DEFAULT_DAILY_ASSUMPTION = 13000;

  const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  // ---------- STATE ----------
  /**
   * @typedef {{ id:string, amount:number, ts:number }} Deposit
   * @typedef {{ key:string, label:string, total:number, subsidy:boolean, closedAt:number }} Archive
   * @typedef {{ id:string, time:string, count:number, intervalMin:number }} NotifSlot
   * @typedef {{ enabled:boolean, slots:NotifSlot[], fired:Object.<string, number> }} NotifPrefs
   */
  const state = {
    /** @type {Deposit[]} */ deposits: [],
    /** @type {Archive[]} */ archive: [],
    subsidy: false,
    monthKey: monthKeyOf(new Date()),
    /** @type {NotifPrefs} */ notif: {
      enabled: false,
      slots: [{ id: 'default', time: '19:00', count: 1, intervalMin: 10 }],
      fired: {} // { 'YYYY-M-D::slotId': attemptsFired }
    }
  };

  function defaultSlot() {
    return { id: uid(), time: '19:00', count: 3, intervalMin: 10 };
  }

  // ---------- DOM REFS ----------
  const $ = (sel) => document.querySelector(sel);

  const el = {
    monthLabel: $('#monthLabel'),
    subsidyToggle: $('#subsidyToggle'),
    totalSaved: $('#totalSaved'),
    targetLabel: $('#targetLabel'),
    remainingLabel: $('#remainingLabel'),
    progressBar: $('#progressBar'),
    progress: document.querySelector('.progress'),
    estDays: $('#estDays'),
    avgDeposit: $('#avgDeposit'),
    depositCount: $('#depositCount'),
    statusBox: $('#statusBox'),
    statusMsg: $('#statusMsg'),
    finishBtn: $('#finishBtn'),

    depositForm: $('#depositForm'),
    amountInput: $('#amountInput'),
    formError: $('#formError'),
    quickBtns: document.querySelectorAll('[data-quick]'),

    depositList: $('#depositList'),
    undoBtn: $('#undoBtn'),

    archiveList: $('#archiveList'),

    grandMonths: $('#grandMonths'),
    grandTotal: $('#grandTotal'),
    grandAvg: $('#grandAvg'),

    finishModal: $('#finishModal'),
    finishConfirm: $('#finishConfirm'),

    notifBtn: $('#notifBtn'),
    notifLabel: $('#notifLabel'),
    notifModal: $('#notifModal'),
    notifEnable: $('#notifEnable'),
    slotsList: $('#slotsList'),
    addSlotBtn: $('#addSlotBtn'),
    notifSave: $('#notifSave'),
    notifTest: $('#notifTest'),
    notifStatus: $('#notifStatus'),

    installBtn: $('#installBtn'),

    toast: $('#toast'),
  };

  // ---------- UTIL ----------
  function monthKeyOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function monthLabelOf(d) {
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  }
  function formatRupiah(n) {
    return Math.round(n).toLocaleString('id-ID');
  }
  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function showToast(msg, ms = 2200) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  // ---------- PERSISTENCE ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      state.deposits = Array.isArray(data.deposits) ? data.deposits : [];
      state.archive = Array.isArray(data.archive) ? data.archive : [];
      state.subsidy = !!data.subsidy;
      state.monthKey = data.monthKey || state.monthKey;

      // migrasi: dari format lama {enabled,time,lastFiredKey} → multi slot
      const n = data.notif || {};
      if (Array.isArray(n.slots)) {
        state.notif = {
          enabled: !!n.enabled,
          slots: n.slots.map(s => ({
            id: s.id || uid(),
            time: s.time || '19:00',
            count: clamp(parseInt(s.count, 10) || 1, 1, 10),
            intervalMin: clamp(parseInt(s.intervalMin, 10) || 10, 1, 60)
          })),
          fired: n.fired && typeof n.fired === 'object' ? n.fired : {}
        };
      } else if (n.time) {
        // upgrade dari schema lama
        state.notif = {
          enabled: !!n.enabled,
          slots: [{ id: uid(), time: n.time, count: 1, intervalMin: 10 }],
          fired: {}
        };
      }
      if (state.notif.slots.length === 0) {
        state.notif.slots = [defaultSlot()];
      }
    } catch (e) {
      console.warn('Gagal memuat data:', e);
    }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // Auto-rollover guard: kalau ganti bulan tapi user belum konfirmasi selesai,
  // tetap pertahankan bulan lama (user yang harus konfirmasi). Kita cuma update label.
  // Tapi monthKey dipakai utk label & lastFiredKey notif.

  // ---------- DERIVED ----------
  function currentTarget() {
    return state.subsidy ? TARGET_SUBSIDY : TARGET_FULL;
  }
  function totalSaved() {
    return state.deposits.reduce((s, d) => s + d.amount, 0);
  }
  function remaining() {
    return Math.max(0, currentTarget() - totalSaved());
  }
  function dailyRate() {
    if (state.deposits.length === 0) return DEFAULT_DAILY_ASSUMPTION;
    // rata-rata setoran per hari aktif: total / (jumlah hari unik bersetor)
    const days = new Set(state.deposits.map(d => new Date(d.ts).toDateString())).size;
    return Math.max(1, totalSaved() / Math.max(1, days));
  }
  function estimatedDays() {
    const r = remaining();
    if (r === 0) return 0;
    return Math.ceil(r / dailyRate());
  }
  function avgDepositValue() {
    if (state.deposits.length === 0) return DEFAULT_DAILY_ASSUMPTION;
    return Math.round(totalSaved() / state.deposits.length);
  }

  // ---------- STATUS MESSAGES ----------
  // tier 0: idle (belum nabung)
  // tier 1: <1.000 (ditolak — handled di validasi)
  // tier 2: 1.000–9.999 dompet darurat
  // tier 3: 10.000–49.999 receh konsisten
  // tier 4: 50.000–99.999 lumayan
  // tier 5: 100.000+ panen
  // tier WIN: target tercapai
  const STATUS_TIERS = {
    idle: [
      'Belum nabung. WiFi-nya udah ngitung mundur, bro.',
      'Tabungan masih nol. Streaming sebentar lagi mati lho.',
      'Mulai dari Rp10.000 juga gapapa, daripada disconnect.'
    ],
    emergency: [
      'Receh banget, tapi mendingan daripada numpang WiFi tetangga.',
      'Dompet darurat detected. Konsisten aja dulu.',
      'Sedikit-sedikit nabung. Tetangga udah ganti password.'
    ],
    consistent: [
      'Receh tapi konsisten — itu cara mahasiswa survive.',
      'Lumayan. Tinggal ulangin tiap hari.',
      'Setoran kayak gini yang bikin WiFi awet.'
    ],
    decent: [
      'Lumayan banget, sultan minor mode aktif.',
      'Setengah jalan udah nyaris. Pertahankan.',
      'Bukan cuma ngarep panen karet ya.'
    ],
    harvest: [
      'Panen besar. Target makin deket, MyRepublic bisa tenang.',
      'Cuan amat. Lanjut sampe lunas, jangan kasih kendor.',
      'Dompet on fire. Sekali lagi target kelar.'
    ],
    win: [
      'TARGET TERKUNCI. Dana siap, bayar MyRepublic sekarang.',
      'Lunas. Wifi aman bulan ini. Tekan tombol selesai di atas.',
      'Mission accomplished. Klik selesai biar bisa mulai bulan baru.'
    ]
  };

  function pickStatus(tier) {
    const arr = STATUS_TIERS[tier];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function statusFor(amountJustAdded) {
    if (totalSaved() >= currentTarget()) return { tier: 'win', cls: 'status-win' };
    if (state.deposits.length === 0) return { tier: 'idle', cls: 'status-idle' };
    const a = amountJustAdded ?? state.deposits[state.deposits.length - 1].amount;
    if (a < 10000) return { tier: 'emergency', cls: 'status-warn' };
    if (a < 50000) return { tier: 'consistent', cls: '' };
    if (a < 100000) return { tier: 'decent', cls: '' };
    return { tier: 'harvest', cls: '' };
  }

  // ---------- RENDER ----------
  function render(amountJustAdded) {
    const target = currentTarget();
    const total = totalSaved();
    const left = remaining();
    const pct = clamp((total / target) * 100, 0, 100);

    el.monthLabel.textContent = monthLabelOf(new Date());
    el.totalSaved.textContent = formatRupiah(total);
    el.targetLabel.textContent = formatRupiah(target);

    // sisa label
    if (left > 0) {
      el.remainingLabel.innerHTML = `· sisa Rp<span class="num">${formatRupiah(left)}</span>`;
      el.remainingLabel.classList.add('muted');
    } else {
      el.remainingLabel.innerHTML = '· lunas ✓';
      el.remainingLabel.classList.remove('muted');
    }

    el.progressBar.style.width = pct + '%';
    el.progress.setAttribute('aria-valuenow', String(Math.round(pct)));

    el.estDays.textContent = formatRupiah(estimatedDays());
    el.avgDeposit.textContent = formatRupiah(avgDepositValue());
    el.depositCount.textContent = String(state.deposits.length);

    // status
    const st = statusFor(amountJustAdded);
    el.statusBox.className = 'status ' + st.cls;
    el.statusMsg.textContent = pickStatus(st.tier);

    // finish button
    el.finishBtn.hidden = total < target;

    // subsidy reflect
    el.subsidyToggle.checked = state.subsidy;

    renderDepositList();
    renderArchive();
    renderGrand();
    renderNotifLabel();
  }

  function renderDepositList() {
    if (state.deposits.length === 0) {
      el.depositList.innerHTML = `<li class="empty">Belum ada setoran bulan ini.</li>`;
      el.undoBtn.disabled = true;
      return;
    }
    // tampilkan terbaru di atas
    const sorted = [...state.deposits].sort((a, b) => b.ts - a.ts);
    el.depositList.innerHTML = sorted.map(d => {
      const date = new Date(d.ts);
      const day = date.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' });
      const time = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      return `
        <li>
          <div class="entry-meta">
            <span class="entry-date">${day}</span>
            <span class="entry-time">${time} WIB</span>
          </div>
          <span class="entry-amount">+ Rp${formatRupiah(d.amount)}</span>
        </li>
      `;
    }).join('');
    el.undoBtn.disabled = false;
  }

  function renderArchive() {
    if (state.archive.length === 0) {
      el.archiveList.innerHTML = `<li class="empty">Belum ada bulan yang tercatat lunas.</li>`;
      return;
    }
    const sorted = [...state.archive].sort((a, b) => b.closedAt - a.closedAt);
    el.archiveList.innerHTML = sorted.map(a => {
      const tag = a.subsidy
        ? `<span class="archive-tag tag-subsidy">subsidi emak</span>`
        : `<span class="archive-tag tag-full">bayar sendiri</span>`;
      return `
        <li>
          <div class="entry-meta">
            <span class="archive-month">${a.label}</span>
            <span class="entry-time">lunas ${new Date(a.closedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </div>
          <div>
            ${tag}
            <span class="entry-amount entry-amount-on-light">Rp${formatRupiah(a.total)}</span>
          </div>
        </li>
      `;
    }).join('');
  }

  function renderGrand() {
    const months = state.archive.length;
    const total = state.archive.reduce((s, a) => s + a.total, 0);
    const avg = months ? Math.round(total / months) : 0;
    el.grandMonths.textContent = String(months);
    el.grandTotal.textContent = formatRupiah(total);
    el.grandAvg.textContent = formatRupiah(avg);
  }

  function renderNotifLabel() {
    if (!state.notif.enabled) {
      el.notifLabel.textContent = 'Pengingat';
      return;
    }
    const slots = state.notif.slots || [];
    if (slots.length === 0) {
      el.notifLabel.textContent = 'Pengingat';
    } else if (slots.length === 1) {
      el.notifLabel.textContent = `Pengingat ${slots[0].time}`;
    } else {
      el.notifLabel.textContent = `Pengingat · ${slots.length} slot`;
    }
  }

  // ---------- ACTIONS ----------
  function parseInputAmount() {
    const raw = el.amountInput.value.replace(/[^\d]/g, '');
    return raw ? parseInt(raw, 10) : NaN;
  }

  function setError(msg) {
    if (!msg) {
      el.formError.hidden = true;
      el.formError.textContent = '';
    } else {
      el.formError.hidden = false;
      el.formError.textContent = msg;
    }
  }

  function addDeposit(amount) {
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Nol atau negatif? Lo nabung apa lo ngutang sama diri sendiri.');
      return false;
    }
    if (amount < MIN_DEPOSIT) {
      setError(`Minimal Rp${formatRupiah(MIN_DEPOSIT)}. Receh juga ada batasnya, bro.`);
      return false;
    }
    state.deposits.push({ id: uid(), amount, ts: Date.now() });
    setError('');
    el.amountInput.value = '';
    save();
    render(amount);
    showToast(`+ Rp${formatRupiah(amount)} masuk tabungan.`);
    return true;
  }

  function undoLast() {
    if (state.deposits.length === 0) return;
    // hapus entry dengan ts terbaru
    const sorted = [...state.deposits].sort((a, b) => b.ts - a.ts);
    const last = sorted[0];
    state.deposits = state.deposits.filter(d => d.id !== last.id);
    save();
    render();
    showToast(`Setoran terakhir Rp${formatRupiah(last.amount)} dihapus.`);
  }

  function finishMonth() {
    if (totalSaved() < currentTarget()) return;
    const now = new Date();
    /** @type {Archive} */
    const entry = {
      key: monthKeyOf(now) + '-' + uid().slice(0, 4),
      label: monthLabelOf(now),
      total: totalSaved(),
      subsidy: state.subsidy,
      closedAt: now.getTime()
    };
    state.archive.push(entry);
    state.deposits = [];
    state.monthKey = monthKeyOf(now);
    save();
    render();
    showToast('Bulan ini dikunci. Selamat, WiFi aman.');
  }

  // ---------- INPUT FORMATTING ----------
  function formatInputLive() {
    const raw = el.amountInput.value.replace(/[^\d]/g, '');
    if (!raw) { el.amountInput.value = ''; return; }
    const n = parseInt(raw, 10);
    el.amountInput.value = n.toLocaleString('id-ID');
  }

  // ---------- EVENTS ----------
  function bindEvents() {
    el.subsidyToggle.addEventListener('change', () => {
      state.subsidy = el.subsidyToggle.checked;
      save();
      render();
      showToast(state.subsidy ? 'Subsidi Emak aktif. Target turun.' : 'Subsidi Emak off. Target full lagi.');
    });

    el.amountInput.addEventListener('input', () => {
      formatInputLive();
      setError('');
    });

    el.depositForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = parseInputAmount();
      if (Number.isNaN(n)) {
        setError('Isi nominalnya dulu, jangan kosong.');
        return;
      }
      addDeposit(n);
    });

    el.quickBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const v = parseInt(btn.dataset.quick, 10);
        addDeposit(v);
      });
    });

    el.undoBtn.addEventListener('click', undoLast);

    el.finishBtn.addEventListener('click', () => openModal(el.finishModal));
    el.finishConfirm.addEventListener('click', () => {
      finishMonth();
      closeModal(el.finishModal);
    });

    // modal close
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t instanceof Element && t.matches('[data-close]')) {
        const m = t.closest('.modal');
        if (m) closeModal(m);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal:not([hidden])').forEach(closeModal);
      }
    });

    // notif modal
    el.notifBtn.addEventListener('click', () => {
      el.notifEnable.checked = state.notif.enabled;
      renderSlots();
      updateNotifStatus();
      openModal(el.notifModal);
    });
    el.addSlotBtn.addEventListener('click', () => {
      addSlotToUI(defaultSlot());
    });
    el.notifSave.addEventListener('click', onNotifSave);
    el.notifTest.addEventListener('click', onNotifTest);
    el.notifEnable.addEventListener('change', updateNotifStatus);
  }

  function openModal(m) { m.hidden = false; }
  function closeModal(m) { m.hidden = true; }

  // ---------- NOTIFIKASI / PENGINGAT ----------
  function notifSupported() { return 'Notification' in window; }

  function updateNotifStatus() {
    if (!notifSupported()) {
      el.notifStatus.hidden = false;
      el.notifStatus.classList.remove('muted');
      el.notifStatus.textContent = 'Browser ini nggak dukung notifikasi.';
      return;
    }
    const p = Notification.permission;
    el.notifStatus.hidden = false;
    el.notifStatus.classList.add('muted');
    if (p === 'denied') {
      el.notifStatus.classList.remove('muted');
      el.notifStatus.textContent = 'Izin notifikasi diblokir. Aktifkan dari setting browser.';
    } else if (p === 'granted') {
      el.notifStatus.textContent = 'Izin notifikasi aktif. Slot di bawah bakal kebakar sesuai jadwal.';
    } else {
      el.notifStatus.textContent = 'Klik simpan, browser akan minta izin notifikasi.';
    }
  }

  async function ensureNotifPermission() {
    if (!notifSupported()) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const res = await Notification.requestPermission();
    return res === 'granted';
  }

  // ---------- SLOT UI ----------
  // UI bekerja di "draft" mode: edit/tambah/hapus slot di DOM nggak langsung
  // mutate state. State baru di-update saat user klik Save.
  function renderSlots() {
    el.slotsList.innerHTML = '';
    state.notif.slots.forEach(slot => addSlotToUI(slot));
  }

  function addSlotToUI(slot) {
    const row = document.createElement('div');
    row.className = 'slot-row';
    row.dataset.id = slot.id;
    row.innerHTML = `
      <label class="slot-time">
        <input type="time" value="${slot.time}" data-field="time" aria-label="Jam"/>
      </label>
      <label class="slot-count">
        <small>Notif</small>
        <input type="number" min="1" max="10" step="1" value="${slot.count}" data-field="count" aria-label="Jumlah notifikasi"/>
      </label>
      <label class="slot-interval">
        <small>Jeda (mnt)</small>
        <input type="number" min="1" max="60" step="1" value="${slot.intervalMin}" data-field="intervalMin" aria-label="Jeda menit"/>
      </label>
      <button type="button" class="slot-remove" aria-label="Hapus slot">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    `;
    row.querySelector('.slot-remove').addEventListener('click', () => removeSlotFromUI(row));
    el.slotsList.appendChild(row);
  }

  function removeSlotFromUI(row) {
    const rows = el.slotsList.querySelectorAll('.slot-row').length;
    if (rows <= 1) {
      showToast('Minimal harus ada 1 slot. Matiin pengingat aja kalau nggak mau.');
      return;
    }
    row.remove();
  }

  function readSlotsFromUI() {
    const rows = el.slotsList.querySelectorAll('.slot-row');
    const slots = [];
    rows.forEach(row => {
      const id = row.dataset.id;
      const time = row.querySelector('[data-field="time"]').value || '19:00';
      const count = clamp(parseInt(row.querySelector('[data-field="count"]').value, 10) || 1, 1, 10);
      const intervalMin = clamp(parseInt(row.querySelector('[data-field="intervalMin"]').value, 10) || 10, 1, 60);
      slots.push({ id, time, count, intervalMin });
    });
    return slots;
  }

  async function onNotifSave() {
    const enabled = el.notifEnable.checked;
    const slots = readSlotsFromUI();
    if (slots.length === 0) {
      showToast('Tambahin minimal 1 slot dulu.');
      return;
    }
    if (enabled) {
      const ok = await ensureNotifPermission();
      if (!ok) {
        updateNotifStatus();
        showToast('Izin notifikasi belum diberikan.');
        return;
      }
    }
    // reset fired tracking kalau slot diubah (hindari miss-fire akibat id berubah)
    state.notif.enabled = enabled;
    state.notif.slots = slots;
    save();
    renderNotifLabel();
    closeModal(el.notifModal);
    if (enabled) {
      const summary = slots.map(s => `${s.time}×${s.count}`).join(', ');
      showToast(`Pengingat aktif: ${summary}.`);
    } else {
      showToast('Pengingat dimatikan.');
    }
    scheduleReminderTick();
  }

  async function onNotifTest() {
    const ok = await ensureNotifPermission();
    if (!ok) { updateNotifStatus(); return; }
    fireReminder(0, 'Tes pengingat — gini bentuknya tiap hari.');
  }

  // pesan beda-beda per attempt + progress-aware
  const REMINDER_MESSAGES = [
    [
      'Setor sekarang biar WiFi aman bulan ini.',
      'Belum nabung hari ini? Receh juga gapapa, asal masuk.',
      'Ingetin: WiFi nggak bayar sendiri, bro.',
      'Nabung dulu sebelum lupa. 30 detik aja.',
      'Sisa target masih jalan. Setor barang Rp10.000.'
    ],
    [
      'Notif kedua. Beneran belum nabung?',
      'Pengingat kedua nih. Buka app-nya, cepet.',
      'Lo skip notif pertama. Ini babak kedua.',
      'Tetangga lagi siap-siap ganti password WiFi-nya.',
      'Masih sibuk? Sini Rp10.000 pun udah bantu.'
    ],
    [
      'Final reminder. Habis ini gue diem.',
      'Tiga kali ngingetin. Kalau masih skip, ya udah.',
      'WiFi mati di tengah Netflix? Don\'t say I didn\'t warn you.',
      'Reminder terakhir. Tabunganmu nggak nambah sendiri.',
      'Last call sebelum besok target makin jauh.'
    ],
    [
      'Lewat tiga notif tetep skip. Respect dulu sama diri sendiri.',
      'Iya gue tau, hidup lagi capek. Tapi Rp5.000 doang.',
      'Notif keempat. Sabar, pengingat juga capek.'
    ],
    [
      'Lo dan gue sama-sama tau ini udah berlebihan.',
      'Notif kelima. Setting jeda lebih lama deh besok.'
    ],
    [
      'Ke-enam. Beneran udah, deh.',
      'Setting count-nya kekecilan kalau masih lewat juga.'
    ]
  ];

  // pesan ngedesak: kalau hari ini sama sekali belum nabung
  const URGENT_MESSAGES = [
    'Hari ini total nabung lo: nol. Masa sih?',
    'Streaknya mau putus nih. Setor minimal Rp1.000.',
    'Kalender kosong hari ini. Receh juga gapapa.',
    'Belum sama sekali. Yuk Rp5.000 dulu.'
  ];

  // pesan supportif: udah nabung hari ini tapi belum target
  const SUPPORTIVE_MESSAGES = [
    'Udah setor hari ini. Mantep, lanjutin besok.',
    'Progress on track. Sisa target makin tipis.',
    'Konsisten gini WiFi-nya bakal aman.',
    'Lo udah lebih maju dari kemarin. Lanjut.'
  ];

  function depositedToday() {
    const today = new Date().toDateString();
    return state.deposits.some(d => new Date(d.ts).toDateString() === today);
  }

  function pickReminderMessage(attemptIndex) {
    const left = remaining();

    // priority 1: target tercapai
    if (left === 0) {
      return 'Tabungan udah cukup. Buka app, klik Selesai bulan ini.';
    }

    // priority 2: udah nabung hari ini → mode supportif (tone melunak)
    if (depositedToday()) {
      const base = SUPPORTIVE_MESSAGES[Math.floor(Math.random() * SUPPORTIVE_MESSAGES.length)];
      return `${base} Sisa Rp${formatRupiah(left)}.`;
    }

    // priority 3: belum nabung hari ini, attempt 1 → urgent dengan info sisa
    if (!depositedToday() && attemptIndex === 0) {
      const base = URGENT_MESSAGES[Math.floor(Math.random() * URGENT_MESSAGES.length)];
      return `${base} Sisa target Rp${formatRupiah(left)}.`;
    }

    // priority 4: attempt ke-N (eskalasi)
    const tier = REMINDER_MESSAGES[Math.min(attemptIndex, REMINDER_MESSAGES.length - 1)];
    const base = tier[Math.floor(Math.random() * tier.length)];
    if (attemptIndex === 0) return `${base} Sisa Rp${formatRupiah(left)}.`;
    return base;
  }

  function fireReminder(attemptIndex = 0, customBody) {
    const body = customBody || pickReminderMessage(attemptIndex);
    const title = attemptIndex > 0
      ? `WiFi Saver · pengingat ${attemptIndex + 1}`
      : 'WiFi Saver';

    // Dedup window 10 menit (sinkron dgn SW dan push dari server)
    const now = Date.now();
    const lastFiredAt = parseInt(localStorage.getItem('wifiSaver.lastFiredAt') || '0', 10);
    if (!customBody && now - lastFiredAt < 10 * 60 * 1000) {
      return; // skip diam-diam, hindari dobel dari sumber lain (push)
    }
    localStorage.setItem('wifiSaver.lastFiredAt', String(now));

    const opts = {
      body,
      icon: 'icons/icon-192.svg',
      badge: 'icons/icon-192.svg',
      tag: `wifi-saver-${attemptIndex}`,
      renotify: true
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, opts);
      }).catch(() => {
        if (notifSupported() && Notification.permission === 'granted') {
          new Notification(title, opts);
        }
      });
    } else if (notifSupported() && Notification.permission === 'granted') {
      new Notification(title, opts);
    }
  }

  // ---------- SCHEDULER ----------
  // Logic per slot: jam target = today HH:MM. attempt ke-i fire kalau now >= jam + i*interval menit,
  // dan i belum di-fire hari ini. Track pakai state.notif.fired[`YYYY-M-D::slotId`] = lastFiredAttempt.
  function dayKey(d) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function pruneOldFiredKeys() {
    const today = dayKey(new Date());
    const fired = state.notif.fired || {};
    let changed = false;
    for (const key of Object.keys(fired)) {
      const datePart = key.split('::')[0];
      if (datePart !== today) {
        delete fired[key];
        changed = true;
      }
    }
    if (changed) state.notif.fired = fired;
    return changed;
  }

  function checkSlots() {
    if (!state.notif.enabled) return;
    if (!notifSupported() || Notification.permission !== 'granted') return;

    const now = new Date();
    const today = dayKey(now);
    let dirty = pruneOldFiredKeys();

    for (const slot of state.notif.slots) {
      const [h, m] = (slot.time || '19:00').split(':').map(n => parseInt(n, 10));
      if (Number.isNaN(h) || Number.isNaN(m)) continue;

      const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0).getTime();
      const elapsedMs = now.getTime() - startMs;
      if (elapsedMs < 0) continue; // belum waktunya

      const intervalMs = slot.intervalMin * 60 * 1000;
      const count = clamp(slot.count, 1, 10);

      // attempt yg seharusnya udah lewat (0-based): floor(elapsed / interval), capped count-1
      const dueAttempts = Math.min(count - 1, Math.floor(elapsedMs / intervalMs));

      const firedKey = `${today}::${slot.id}`;
      const lastFired = state.notif.fired[firedKey];
      const lastFiredIdx = (typeof lastFired === 'number') ? lastFired : -1;

      // grace: kalau user buka app jauh setelah jam target, tetap fire attempt yg belum.
      // Tapi jangan spam: kalau gap > 30 menit dari attempt terakhir yg seharusnya, skip yg basi.
      const GRACE_MS = 30 * 60 * 1000;
      for (let i = lastFiredIdx + 1; i <= dueAttempts; i++) {
        const targetMs = startMs + i * intervalMs;
        const lateMs = now.getTime() - targetMs;
        if (lateMs > GRACE_MS) continue; // udah kelewat lama, skip biar nggak nyampah
        fireReminder(i);
        state.notif.fired[firedKey] = i;
        dirty = true;
        // jangan fire semua sekaligus dalam 1 tick — biar terasa kayak terjadwal,
        // kita fire 1 attempt per tick. break.
        break;
      }
    }

    if (dirty) save();
  }

  function scheduleReminderTick() {
    clearInterval(scheduleReminderTick._t);
    // tick tiap 30 detik (lebih responsif untuk count yg sering)
    scheduleReminderTick._t = setInterval(checkSlots, 30 * 1000);
    // initial check
    setTimeout(checkSlots, 1500);

    // sinkron ke SW (lapis 1) dan ke server (lapis 2)
    handoffToServiceWorker();
    syncScheduleToServer();
  }

  // ---------- LAPIS 1: handoff schedule ke Service Worker (setTimeout) ----------
  // SW bisa schedule timer reliable selama browser belum mematikan SW (biasanya
  // beberapa menit setelah event terakhir). Cocok untuk slot yg jam-nya dekat
  // dengan saat user buka app.
  async function handoffToServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg || !reg.active) return;
    if (!state.notif.enabled) {
      reg.active.postMessage({ type: 'CANCEL_REMINDERS' });
      return;
    }

    const items = [];
    const now = new Date();
    const today = dayKey(now);

    for (const slot of state.notif.slots) {
      const [h, m] = (slot.time || '19:00').split(':').map(n => parseInt(n, 10));
      if (Number.isNaN(h) || Number.isNaN(m)) continue;
      const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0).getTime();
      const intervalMs = slot.intervalMin * 60 * 1000;
      const count = clamp(slot.count, 1, 10);
      const firedKey = `${today}::${slot.id}`;
      const lastFiredIdx = (typeof state.notif.fired[firedKey] === 'number') ? state.notif.fired[firedKey] : -1;

      for (let i = lastFiredIdx + 1; i < count; i++) {
        const fireAt = startMs + i * intervalMs;
        if (fireAt <= now.getTime()) continue; // udah lewat, biarkan window-side scheduler yg handle (grace logic)
        items.push({
          key: `${firedKey}::${i}`,
          title: i > 0 ? `WiFi Saver · pengingat ${i + 1}` : 'WiFi Saver',
          body: pickReminderMessage(i),
          fireAt,
          tag: `wifi-saver-${i}`
        });
      }
    }

    reg.active.postMessage({ type: 'SCHEDULE_REMINDERS', payload: items });
  }

  // ---------- LAPIS 2: push subscription + sync schedule ke server ----------
  async function ensurePushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) return null;

    let sub = await reg.pushManager.getSubscription();
    if (sub) return sub;

    // Ambil VAPID public key dari endpoint /api/vapid-public
    const vapid = await fetch('/api/vapid-public').then(r => r.ok ? r.text() : null).catch(() => null);
    if (!vapid) return null;

    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid)
      });
      // kirim sub ke server
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub)
      });
      return sub;
    } catch (e) {
      console.warn('Push subscribe gagal:', e);
      return null;
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const arr = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
    return arr;
  }

  let _syncTimer = null;
  async function syncScheduleToServer() {
    // debounce kecil
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      if (!state.notif.enabled) {
        // matiin: tetap kirim biar server tau
        try {
          await fetch('/api/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false, slots: [] })
          });
        } catch (_) {}
        return;
      }

      const sub = await ensurePushSubscription();
      if (!sub) return; // tanpa subscription, server nggak bisa kirim push

      try {
        await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            slots: state.notif.slots,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta',
            tzOffsetMinutes: -new Date().getTimezoneOffset(),
            subscription: sub
          })
        });
      } catch (e) {
        console.warn('Sync schedule gagal:', e);
      }
    }, 600);
  }

  // ---------- PWA INSTALL ----------
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    el.installBtn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    el.installBtn.hidden = true;
    showToast('App terpasang. Buka dari layar utama.');
  });
  el.installBtn?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    el.installBtn.hidden = true;
  });

  // ---------- SERVICE WORKER ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.warn('SW gagal didaftar:', err);
      });
    });
  }

  // ---------- INIT ----------
  function init() {
    load();
    bindEvents();
    render();
    scheduleReminderTick();

    // refocus fix: kalau user balik ke tab, render ulang biar label bulan & estimasi up-to-date
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) render();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
