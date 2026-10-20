# SPEC: Prototype kios APP AI (Sapa) yang bisa didemokan dari ujung ke ujung

Status: draf 1, 2026-10-20. Sumber: `CLAUDE.md`, `sapa-flow/` (mesin, 40 uji hijau), proposal Healthkathon 2026, dan wawancara dengan tim.

## 1. Tujuan dan batas demo

Satu laptop menjalankan seluruh demo:

- **Layar kios:** avatar Sapa beranimasi dengan lip-sync, subtitle besar, kartu konfirmasi data, dan nomor antrean.
- **Interaksi:** suara (STT online/offline, TTS pra-render), kamera (deteksi wajah lokal untuk mock FRISTA), dan pemindaian dokumen/kode booking lewat kamera (OCR via API AI).
- **Dashboard petugas:** di jendela kedua.

Prototype dinyatakan "jalan" kalau semua skenario E2E di bagian 7 lulus di laptop demo.

**Prinsip yang tidak boleh dilanggar** (CLAUDE.md):
- Alur hanya ada di `sapa-flow` dan modul lain tidak membuat alur paralel.
- Kios tidak pernah menolak pasien.
- Nama, NIK, nomor kartu, poli, kode booking, dan nomor antrean tidak diucapkan.
- AI dan kios hanya membaca. Satu-satunya yang menulis adalah petugas.
- Semua sistem eksternal lewat adapter dan memakai versi mock.
- Data peserta dummy.
- Frame kamera hanya diproses di memori.

## 2. Keputusan dari wawancara

| Hal | Keputusan |
|---|---|
| Stack UI | Vite + React + TS, satu aplikasi web dengan rute `/kios` dan `/petugas`. Kios dibuka di Chrome `--kiosk`. |
| Server | Satu proses Node (TS strict) yang mengimpor `sapa-flow`. Klien terhubung lewat WebSocket. Kunci API hanya di server (`.env`). |
| Avatar | Layer mesh kit (`sapa-mesh-kit-idle`, 18 layer PNG) dianimasikan di Canvas 2D, dengan lip-sync dari viseme. |
| STT | Dua mode, pindah otomatis. Online: Azure Speech id-ID streaming. Offline: Whisper lokal. Profil `gpu` memakai faster-whisper large-v3-turbo; profil `cpu` memakai whisper.cpp small q5. Spesifikasi laptop belum diketahui, jadi profil dipilih lewat `.env` setelah diukur. |
| TTS | Semua varian naskah dirender sekali saat build dengan Azure Neural id-ID. Hasilnya MP3 dan timeline viseme. Runtime tidak memanggil TTS. |
| Perangkat | Laptop saja. Kamera laptop dipakai untuk wajah dan pemindaian (bergantian). Mikrofon dan speaker bawaan laptop. Lampu dan tombol "Ulangi" / "Panggil Petugas" tampil di layar (juga F1/F2). Nomor antrean tampil di layar. |
| OCR | Lewat API AI. Asumsi: Claude Haiku 5.5 vision dengan strict tool use, karena SDK sudah terpasang di `sapa-flow`. Adapter bisa diganti vendor lain. |
| Mock FRISTA | Deteksi wajah lokal (MediaPipe Face Detector di browser) menghasilkan `wajah_tidak_terdeteksi` (tidak ada wajah, terlalu jauh, gelap). Kalau wajah terdeteksi, hasil `cocok`/`tidak_cocok` diambil dari seed dummy per NIK. |
| Mode konsol | Mode ditanya dulu, baru izin. Sapa melayani BPJS dan Check-in. Non BPJS dan Admission langsung ke petugas. |
| Sidik jari | Ditawarkan langsung kalau wajah gagal. Dipakai mock, hasilnya dari seed per NIK. |
| Nomor antrean | Dibuat oleh sistem petugas (mock), lalu dibawa `PETUGAS_SETUJU`. Kios tidak memanggil "antrean add". |
| Kode booking | Dipindai dari layar HP (gambar layar Mobile JKN dummy), dibaca oleh adapter OCR. |

## 3. Arsitektur

```
 Chrome --kiosk /kios                 Chrome /petugas (jendela kedua)
 ┌───────────────────────────┐        ┌──────────────────────────┐
 │ Avatar (Canvas+lip-sync)  │        │ Daftar sesi, draf,       │
 │ Subtitle · Kartu · Antrean│        │ kolom ragu kuning,       │
 │ Mic+VAD · Kamera+MediaPipe│        │ Setuju / Ambil alih /    │
 │ Tombol layar (F1/F2)      │        │ Tiba                     │
 └────────────┬──────────────┘        └────────────┬─────────────┘
              │ WS /ws/kios                         │ WS /ws/petugas
 ┌────────────▼─────────────────────────────────────▼─────────────┐
 │ server/ (Node)                                                 │
 │  kios/   runner = sapa-flow buatSesi() + tick 1 dtk            │
 │          stt/ (azure | whisper, router)   ocr/ (claude)        │
 │          adapter/ BACA SAJA: vclaim hfis antrean simrs         │
 │                              frista sidikjari  (semua *.mock)  │
 │          audit/ JSONL tanpa gambar                             │
 │  petugas/ dashboard API + sistemRs.mock (satu-satunya "tulis") │
 └────────────────────────────────────────────────────────────────┘
```

Struktur repo (npm workspaces):

```
sapa-flow/       mesin, naskah, pemahaman, runner (sudah ada)
server/src/kios/      runner, stt, ocr, adapter baca-saja, audit
server/src/petugas/   API dashboard, sistemRs.mock (buat nomor antrean)
server/data/dummy.json   peserta, booking, RM, hasil FRISTA/sidik jari dummy
web/src/kios/    layar kios          web/src/petugas/   dashboard
web/public/sapa/ layer avatar + audio pra-render + viseme
tools/           tts-render, kartu-demo (PDF spesimen), eval-stt
e2e/             Playwright + media palsu
```

Pemisahan kode kios dan petugas dijaga oleh tes. Uji "endpoint tulis dilarang" (sudah ada untuk `sapa-flow/src`) diperluas ke `server/src/kios/` dan `web/src/kios/`. Dengan begitu, kode tulis hanya boleh ada di `server/src/petugas/`.

## 4. Modul

### 4.1 `sapa-flow` (sudah ada)
- Mesin dengan 12 keadaan. Lihat `sapa-flow/README.md` dan `src/mesin.ts`.
- Runner `buatSesi(hariIni, penilai, jam, waktu)` menyediakan `kirim(pm)`, `tick()`, `keadaan()`, dan `awal`.
- `WAKTU`: batas giliran 30 detik dan sesi 5 menit (nilai awal).
- Modul lain hanya mengirim `PeristiwaMentah` dan menjalankan `Efek`. Modul lain tidak memutuskan alur.

### 4.2 `server/kios`: sesi dan orkestrasi
- Satu sesi aktif per kios. Sesi dibuat saat pasien menyentuh layar atau suara terdeteksi di layar siaga, lalu `tick()` dipanggil tiap 1 detik.
- Menerjemahkan pesan klien menjadi `PeristiwaMentah`, lalu mengirim `Efek[]` ke klien kios. Efek `kirim_draf_ke_petugas` dan `panggil_petugas` diteruskan ke modul petugas.
- Memperkaya peristiwa sebelum masuk mesin:
  - Kartu: NIK atau nomor kartu dari OCR, lalu `vclaim.peserta()` dan `simrs.statusRm()`, menjadi `KARTU_TERBACA{identitas, rm}`.
  - Kode booking: `antrean.booking()`, `vclaim.peserta()`, `simrs.statusRm()`, dan `hfis.jadwal()` (untuk jam praktik), menjadi `KODE_BOOKING_TERBACA`.
  - Wajah: metrik dari browser plus seed, menjadi `FRISTA{hasil}`.
  - Sidik jari: `SIDIK_JARI{hasil}` dari mock.
- Setelah sesi `SELESAI` dan pasien pergi (10 detik tanpa wajah), keadaan dikosongkan dan layar kembali siaga.

### 4.3 `server/kios/stt`: STT online/offline
- `SttRouter` memakai Azure lebih dulu. Router pindah ke Whisper kalau Azure gagal tersambung, tidak memberi hasil final dalam 3 detik setelah VAD selesai, atau sistem sedang offline. Router mencoba Azure lagi setiap 60 detik.
- Mode yang dipakai dicatat di audit sebagai `stt: "online" | "offline"`. Ini perlu tambahan kecil di `CatatanAudit` pada fase STT.
- Phrase list Azure: nggih, monggo, muhun, BPJS, Mobile JKN, booking, rujukan, kontrol, puskesmas.
- Half-duplex: mikrofon ditutup selama audio Sapa diputar. Pasien tidak bisa menyela (barge-in di luar cakupan).
- Audio hanya ada di memori dan dibuang setelah transkrip final. Transkrip mentah tidak ditulis ke log; yang keluar ke penilai hanya hasil `samarkan()`, sesuai yang sudah dilakukan `proses()`.

### 4.4 `tools/tts-render` dan pemutar TTS
- Semua `Giliran` dienumerasi, berupa kombinasi keadaan × varian × sapaan (Bapak/Ibu/Bapak/Ibu). Enumerasi memakai pendekatan `scripts/naskah-json.ts` yang diperluas.
- Setiap giliran dirender lewat SSML `<prosody rate>` sesuai `tempo`. Hasilnya `web/public/sapa/audio/<hash>.mp3` dan `<hash>.viseme.json`, dengan `hash = sha256(ucapan + tempo)`.
- Uji: setiap `Giliran` yang bisa dihasilkan mesin punya file audio. Kalau ada yang hilang, build gagal.
- Kalau Azure tidak mengeluarkan viseme untuk id-ID, timeline mulut dibuat dari huruf vokal teks dan word boundary. Ini perlu dicek di awal fase avatar.

### 4.5 `web/kios`: layar kios
Sekarang: `sapa-flow/src/kios-layar/` (node:http + SSE, hanya 127.0.0.1; `npm run kios`, buka di Chrome `--kiosk`). Nanti `web/` React + WS dengan kontrak yang sama (`kontrak.ts`).
- Desain utama potret 1080×1920; lanskap 1920×1080 (laptop demo) dua kolom. Huruf memakai px tetap, jadi zoom browser 200% benar-benar memperbesar dan tata letak mengalir ulang.
  - Subtitle minimal 48 px, kontras tinggi, selalu tampil.
  - Avatar: klip WebM VP9 alpha per `Ekspresi` (`page/sapa/`, dari `sapa-animasi.zip`). Cadangan frame PNG (dimuat lengkap dulu, lalu 24 fps) untuk browser tanpa VP9 alpha; `?avatar=png` memaksa cadangan. `prefers-reduced-motion` menghentikan animasi.
  - Satu tombol per opsi per topik: izin dan konfirmasi Ya/Tidak, mode 4, kunjungan 3. Tombol jawaban menempel di bawah area gulir sehingga selalu terlihat.
  - "Ulangi" dan "Panggil Petugas" selalu terlihat di bawah layar.
  - Kartu konfirmasi (`tampilkan_kartu`, baris `ragu` kuning + "Mohon dicek"), layar nomor antrean (nomor, arahan poli/admisi), indikator lampu pemindai/kamera.
- Ketukan opsi masuk ke runner sebagai `SENTUH_OPSI` → `JAWABAN` pasti dengan `sumber: "sentuh"`, tanpa AI. Opsi yang bukan milik topik keadaan ini diabaikan (diaudit). Pemeriksaan darurat hanya berlaku untuk ucapan.
- Data pribadi hanya di kartu layar: nama, tanggal lahir, dan poli tampil penuh; NIK disamarkan kecuali 4 digit terakhir (oleh mesin, sebelum sampai ke browser). Tidak pernah di subtitle (dijamin naskah).
- Tidak ada teks yang dikarang di klien. Semua kalimat berasal dari `Giliran`; label tombol dari `LABEL_OPSI` (mapped type per opsi).
- Uji layar (`npm run uji:layar`, Playwright + Chrome/Edge terpasang, ikut `npm run cek`): matriks potret/lanskap × zoom 100%/200% (zoom = viewport CSS separuh, deviceScaleFactor 2). Di setiap layar: tidak ada gulir horizontal; subtitle, tombol jawaban, isi kartu, dan nomor antrean tampak utuh tanpa gulir (hit-test `elementFromPoint`, bukan hanya batas viewport); target sentuh ≥ 64 px; subtitle ≥ 48 px; nilai kartu tidak terpatah; DOM tidak pernah memuat NIK / nomor kartu utuh. Bukti: `sapa-flow/bukti/layar/*.png`.

### 4.6 `web/kios/avatar`: Sapa
- Canvas 2D menumpuk 18 layer (kanvas 1984×1648, diskalakan) dengan pivot dari `pivot.json`.
- Idle (loop 3 detik, sesuai BACA-SAYA): napas, badan naik-turun, lengan berayun, pupil melirik, dan berkedip.
- Pose per `Ekspresi`:

  | Ekspresi | Pose (dari layer) | Properti tambahan |
  |---|---|---|
  | menyapa | lengan kanan diputar ke atas sambil melambai; mata senyum | garis lambai |
  | mendengar | badan miring −5° | gelombang suara |
  | memandu | lengan kanan menunjuk ke atas | ikon kamera |
  | petugas | lengan kanan diangkat tenang, badan miring +4° | lonceng |
  | senang | kedua lengan diangkat; mata senyum | bintang |

  Properti tambahan diambil dari SVG di `sapa-flow/avatar.json`. Layer tidak punya "mata senyum" (^ ^), jadi bentuk itu digambar sebagai path dari `avatar.json`. Risikonya: lengan hasil rotasi bisa terlihat janggal. Cadangannya: pakai klip WebM untuk pose itu (`sapa-animasi/`).
- Lip-sync memetakan viseme Azure ke lima layer mulut:

  | Viseme Azure | Layer mulut |
  |---|---|
  | 0 (diam) | `mulut_senyum` |
  | 1, 2, 9, 11 | `mulut_a` |
  | 3, 7, 8, 10 | `mulut_o` |
  | 4, 5, 6 | `mulut_e` |
  | lainnya | `mulut_senyum` |

  `mulut_lebar` dipakai di ekspresi senang. Viseme disinkronkan ke `audio.currentTime`.

### 4.7 `web/kios/kamera` dan mock FRISTA
- `getUserMedia` 1280×720. MediaPipe Face Detector (WASM, model dibundel lokal) berjalan pada frame di memori.
- Browser mengirim metrik saja, tanpa gambar: `{ wajah: boolean, luasRelatif, luminans }`. Aturannya:
  - Tidak ada wajah selama 3 detik → `tidak_diketahui`.
  - `luasRelatif` < 0,04 → `terlalu_jauh`.
  - `luminans` < 60/255 → `gelap`.
  - Wajah stabil 1 detik → server mengambil hasil seed (`cocok`/`tidak_cocok`) untuk NIK tersebut.
- `tertutup` (masker) tidak dideteksi di prototype. Hasil itu hanya bisa muncul lewat seed.
- Efek `kamera: naikkan_eksposur` diterapkan lewat constraint `exposureCompensation` kalau webcam mendukung; kalau tidak, hanya dicatat. Efek `bingkai_otomatis` di laptop berupa crop digital di pratinjau.
- Larangan: `canvas.toBlob` atau `toDataURL` untuk wajah, upload frame wajah, dan menyimpan gambar ke disk atau log.

### 4.8 Pemindai dan `server/kios/ocr`
- Kamera yang sama dipakai dalam mode pindai saat lampu pemindai menyala. Pasien atau demonstran mengarahkan kartu, surat, atau layar HP ke kamera.
- Gambar diambil otomatis setelah bingkai stabil 1 detik (selisih antar-frame kecil), lalu satu JPEG dikirim lewat WS sebagai biner.
- Server meneruskan gambar ke Claude Haiku 5.5 vision dengan strict tool. Ada tiga skema:
  - `kartu` → `{ nik? , nomorKartu? }`
  - `dokumen` → `DokumenOcr` (sudah ada, termasuk keyakinan per kolom)
  - `booking` → `{ kodeBooking }`
  Hasil divalidasi ulang dengan Zod, lalu buffer dibuang.
- Kegagalan (tidak terbaca, API putus, atau parse gagal) menjadi `KARTU_GAGAL`, `DOKUMEN_GAGAL`, atau `KODE_BOOKING_GAGAL`. Batas percobaan di mesin lalu mengarahkan ke petugas.
- Catatan jujur: keyakinan per kolom dari LLM tidak terkalibrasi. Bendera `ocr_ragu` di prototype hanya indikatif.

### 4.9 Adapter sistem eksternal (`server/kios/adapter`, baca saja, semua mock)

```ts
interface VClaim {
  peserta(q: { nik: string } | { nomorKartu: string }): Promise<IdentitasKartu | null>;
  rujukan(nomor: string): Promise<{ poli: Poli; berlakuSampai: string } | null>;          // disiapkan, belum dipakai alur
  rencanaKontrol(nomorSurat: string): Promise<{ poli: Poli; tanggal: string } | null>;   // disiapkan, belum dipakai alur
}
interface Hfis    { jadwal(poli: Poli, tanggal: string): Promise<{ jamPraktik: string } | null> }
interface Antrean { booking(kode: string): Promise<{ nomorKartu: string; booking: Booking } | null> } // hanya untuk tanggal hari ini
interface Simrs   { statusRm(nik: string): Promise<StatusRm> }
```

Biometrik (FRISTA dan sidik jari) tidak lewat klien ini. Satu-satunya batasnya adalah adaptor `VerifikasiBiometrik` (4.12).

- Setiap mock membaca `server/data/dummy.json`. Kolom yang dikembalikan sudah sempit (`z.object` bawaan).
- Tidak ada method tulis pada antarmuka kios.
- Respons mock tidak berisi diagnosa, riwayat I-Care, iuran, atau foto.
- Kalau sidik jari "tidak tersedia" (tanpa alat), mock mengikuti seed.

### 4.10 `server/petugas` dan `web/petugas`: dashboard
Sekarang: `sapa-flow/src/petugas/` (node:http + SSE, `npm run dashboard`); nanti `web/` React + WS dengan kontrak yang sama (`kontrak.ts`).
- Masuk dengan `DASHBOARD_PIN` dari `.env` + nama petugas (cookie HttpOnly, SameSite=Strict).
- Kartu untuk sesi di `MEMANGGIL_PETUGAS` (alasan, prioritas; `kemungkinan_darurat` merah di atas) dan `MENUNGGU_PETUGAS_CEK` (draf menunggu cek), dengan durasi sesi berjalan.
- Data minimal: dashboard TIDAK menerima draf utuh. Nilai hanya untuk kolom yang ditandai ragu, kartu vs dokumen berdampingan; NIK dan nomor kartu disamarkan kecuali 4 digit terakhir. Nilai hanya di memori dan dibuang saat sesi `SELESAI`.
- Tombol:
  - **Setuju** (draf): sistem RS palsu membuat nomor antrean (`<kodePoli>-<urut>`), lalu `PETUGAS_SETUJU{nomorAntrean}`.
  - **Ambil alih** (draf): `PETUGAS_AMBIL_ALIH`.
  - **Saya datang** (panggilan): `PETUGAS_DATANG`; kios tetap di `MEMANGGIL_PETUGAS`, hanya subtitle berganti.
  - **Selesai** (panggilan): `PETUGAS_SELESAI` → `SELESAI` (`dilayani_petugas`). Kios terkunci (tidak ada sesi baru) sampai peristiwa ini; diuji properti.
- Audit keputusan petugas (`log/audit-petugas-YYYY-MM-DD.jsonl`): waktu, idSesi, keputusan, nama petugas, dan NAMA kolom ragu saja, tanpa nilai.
- Celah: PIN tanpa pembatas percobaan (cukup untuk jaringan lokal RS); "Ambil alih" langsung mengakhiri sesi kios, belum ikut kunci "sampai selesai".

### 4.11 Audit
- Log append-only `server/log/audit-YYYY-MM-DD.jsonl`, satu baris per efek `audit`, berisi `{waktu, idSesi, catatan}`. `durasi_sesi` ditulis oleh runner.
- Log tidak boleh berisi gambar, audio, atau transkrip mentah.

### 4.12 Adaptor perangkat (`sapa-flow/src/adaptor/`)
Antarmuka bertipe di `antarmuka.ts`; `pengemudi.ts` satu-satunya penghubung ke runner (memperkaya bacaan kartu/booking lewat klien BPJS, memanggil biometrik saat mesin masuk keadaan verifikasi, membagikan efek). Palsu di `src/mock/adaptor-palsu.ts`, dikendalikan panel demo di memori dan `npm run demo -- --wajah=gagal --sidikjari=lolos --mode=nonbpjs`. Panel HTML lewat WS di fase 1–2.

| Perangkat | Status sekarang | Implementasi asli yang diharapkan | Pertanyaan terbuka |
|---|---|---|---|
| STT (`Stt`) | antarmuka + palsu | Router Azure id-ID / Whisper lokal di server (4.3) | Latensi Whisper profil cpu di laptop demo; phrase list cukup untuk Jawa/Sunda? |
| TTS (`Tts`, hanya `Giliran`) | antarmuka + palsu | Pemutar audio pra-render + viseme di browser (4.4); tidak ada TTS runtime | Azure mengeluarkan viseme id-ID? |
| Kamera OBSBOT (`Kamera`) | antarmuka + palsu | Prototype: kamera laptop, eksposur via constraint, bingkai = crop digital. Kios: OBSBOT SDK | SDK OBSBOT bisa dipanggil dari Node/browser? Lisensi dan dukungan Windows? |
| Pemindai dokumen (`Pemindai`) | antarmuka + palsu | Kamera mode pindai + OCR Claude vision (4.8); kios: pemindai dokumen fisik | Keyakinan OCR LLM tidak terkalibrasi; model pemindai fisik dan driver-nya? |
| Printer antrean (`PrinterAntrean`) | antarmuka + palsu (nomor di layar) | Prototype: layar saja. Kios: printer thermal ESC/POS | Format karcis yang diminta RS? Perlu QR? |
| Biometrik (`VerifikasiBiometrik`) | antarmuka + palsu; batas waktu = batas giliran | Wajah: FRISTA (prototype: MediaPipe lokal + hasil seed); sidik jari: alat 1:1 | FRISTA bisa dipanggil sistem pihak ketiga, atau hanya aplikasi resmi? Alat sidik jari yang disertifikasi BPJS? |

## 5. Antarmuka antar modul

### WebSocket `/ws/kios`
Skema Zod: `sapa-flow/src/kios-layar/kontrak.ts` (sekarang SSE `/peristiwa` + POST `/tombol`, nanti WS). Layar TIDAK menerima `Efek` mentah: draf petugas, audit, dan efek kamera tidak pernah sampai ke browser kios.

**Klien ke server:**

```ts
type DariKios =
  | { t: "mulai" }                                   // sentuh layar di layar siaga / "Pasien berikutnya"
  | { t: "tombol"; nama: "ulangi" | "petugas" }
  | { t: "pilih"; opsi: string }                     // ketukan opsi → SENTUH_OPSI (sumber "sentuh")
  // Rencana fase STT/kamera (belum ada):
  | { t: "ucapan"; transkrip: string }               // final dari STT (E2E / debug)
  | { t: "audio"; pcm16: ArrayBuffer }               // potongan mic 16 kHz saat VAD aktif
  | { t: "wajah"; ada: boolean; luasRelatif: number; luminans: number }
  | { t: "pindai"; jenis: "kartu" | "dokumen" | "booking"; jpeg: ArrayBuffer } // biner, tidak disimpan
  | { t: "audio_selesai"; hash: string };            // Sapa selesai bicara → mic dibuka
```

STT berjalan di server (Azure SDK dan Whisper), jadi klien mengirim `audio`. Pesan `ucapan` hanya dipakai oleh E2E dan mode debug.

**Server ke klien:**

```ts
type KeKios =
  | { t: "keadaan"; tag: Tag | "SIAGA"; opsi: { nilai: string; label: string }[] } // tombol jawaban topik ini
  | { t: "bicara"; subtitle: string; ekspresi: Ekspresi }   // audio pra-render (hash) menyusul di fase TTS
  | { t: "kartu"; judul: string; baris: { label: string; nilai: string; ragu: boolean }[] } // NIK sudah tersamar
  | { t: "lampu"; target: "pemindai" | "wajah"; nyala: boolean }
  | { t: "antrean"; nomorAntrean: string; arahan: "poli" | "admisi" }
  | { t: "petugas"; prioritas: "biasa" | "segera" };
  // Rencana fase STT: | { t: "stt"; mode: "online" | "offline"; sebagian?: string }
```

### WebSocket `/ws/petugas`

```ts
// Skema Zod: sapa-flow/src/petugas/kontrak.ts (SSE + POST sekarang, WS nanti).
type KePetugas =
  | { t: "sesi"; idSesi: string; tag: Tag; mulai: number; petugasDatang: boolean }
  | { t: "draf"; idSesi: string; kolomRagu: { kolom: string; kartu: string | null; dokumen: string | null }[] } // bukan draf utuh
  | { t: "panggil"; idSesi: string; alasan: AlasanPetugas; prioritas: "biasa" | "segera" };
type DariPetugas = {
  t: "setuju" | "ambil_alih" | "datang" | "selesai"; // setuju: sistem RS → nomorAntrean → PETUGAS_SETUJU
  idSesi: string;
  petugas: string; // diisi server dari sesi login, bukan dari klien
};
```

Pesan `audit` tidak dikirim ke dashboard (data minimal); audit ditulis di server.

Semua pesan divalidasi dengan Zod di server (batas kepercayaan). Pesan yang tidak valid dibuang dan dicatat.

### Variabel `.env` (tidak masuk repo; disediakan `.env.example`)
`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `ANTHROPIC_API_KEY`, `EXPERIENTIAL_API_KEY` (Jev lewat gateway; opsional), `JEV_BATAS_WAKTU_MS`, `STT_MODE=auto|online|offline`, `WHISPER_PROFILE=gpu|cpu`, `WHISPER_MODEL_PATH`, `DASHBOARD_PIN`, `DASHBOARD_PORT`, serta kredensial dan base URL BPJS di `sapa-flow/.env.example`.

## 6. Di luar cakupan prototype
- Integrasi resmi FRISTA, VClaim, HFIS, Antrean, dan SIMRS. Alat sidik jari, OBSBOT SDK, printer thermal, tombol fisik, dan lampu fisik (demo hanya memakai laptop).
- Penulisan nyata ke SIMRS/Antrean. `sistemRs.mock` hanya membuat nomor di memori.
- Alur Non BPJS dan Admission sesudah petugas dipanggil.
- Pencocokan OCR dengan VClaim Rujukan/Rencana Kontrol (adapter disiapkan, tidak dipakai alur).
- Lapisan deteksi anomali (aturan dan robust z-score) serta daftar tinjauan verifikator BPJS.
- Multi-kios, login dan otorisasi petugas, serta penyimpanan permanen selain log JSONL.
- Barge-in, deteksi masker, dan pembingkaian kamera fisik.
- Pengumpulan rekaman relawan dan DPIA. Pengukuran WER memakai alat di `tools/eval-stt`, tapi datanya disiapkan terpisah.
- Pembangunan ulang `sapa-flow/page/alur-sapa.html`.

## 7. Skenario uji end-to-end

**Otomatis:** Playwright menjalankan Chrome dengan `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` dan `--use-file-for-fake-video-capture=e2e/media/<x>.y4m`. Ucapan dikirim lewat pesan `ucapan` (STT tidak ikut diuji di jalur ini). STT diuji terpisah di E6 dengan WAV.

**Manual:** naskah demo di `e2e/DEMO.md` dengan suara dan kamera asli.

Setiap skenario harus memeriksa jalur keadaan, efek di layar kios, dan isi dashboard.

| # | Skenario | Langkah | Lulus bila |
|---|---|---|---|
| E1 | BPJS kontrol, RM ada | "pakai BPJS" → "iya boleh" → kartu demo Siti → wajah ada → "kontrol" → surat kontrol → "betul" → petugas Setuju | Jalur sama dengan uji skenario 1. Layar menampilkan nomor `PD-…` dan "Silakan ke poli". Audio yang diputar sesuai hash naskah. Dashboard menampilkan draf tanpa bendera dan verifikasi = wajah. Audit berisi `durasi_sesi` kurang dari 180 detik. |
| E2 | Check-in kode booking | "sudah booking di Mobile JKN" → izin → gambar layar HP dummy → wajah → "betul" → Setuju | Kartu konfirmasi berisi jam praktik dari HFIS mock. `sumberKolom.poliTujuan = booking`. TANYA_KUNJUNGAN dan SCAN_DOKUMEN tidak muncul. |
| E3 | Wajah gagal, sidik jari | Video gelap (y4m) tiga kali → mock sidik jari `cocok` | Subtitle menampilkan "Lampu diterangkan…" lalu "Letakkan jari telunjuk…". Draf `verifikasi = sidik_jari`. Petugas tidak dipanggil. |
| E4 | Identitas mencurigakan | NIK seed dengan FRISTA `tidak_cocok` dan sidik jari `tidak_cocok` | Petugas dipanggil dengan alasan `verifikasi_tidak_cocok`. Dashboard menampilkan 2 audit FRISTA dan 2 audit sidik jari. Pasien mendapat "Petugas segera datang", tidak ada penolakan. |
| E5 | Non BPJS / Admission | "umum saja" lalu sesi baru "mau rawat inap" | Petugas dipanggil langsung dengan alasan `non_bpjs` / `admission`. Tidak ada audit izin. Kamera pindai tidak menyala. |
| E6 | Internet putus | Matikan Wi-Fi sebelum sesi, lalu jalankan E1 dengan suara WAV ke STT | Indikator STT menunjukkan "offline". Jawaban dipahami lewat kata kunci (`sumber: kata_kunci` di audit). Pindai kartu gagal karena OCR offline, sehingga petugas dipanggil dengan alasan `kartu_tak_terbaca`. Kios tidak macet dan tidak menolak. |
| E7 | Pasien diam | Mulai sesi, tidak menjawab selama 60 detik | Pertanyaan mode diulang sekali di detik ke-30. Di detik ke-60 petugas dipanggil dengan alasan `diam_terlalu_lama`. Batas sesi 5 menit dibuktikan oleh uji unit `sesi.test.ts`, bukan E2E. |
| E8 | Darurat | "BPJS, tapi dada saya sakit sekali" | Panggilan dengan prioritas `segera`, ditandai merah di urutan teratas dashboard dalam waktu kurang dari 2 detik. |
| E9 | BPJS tanpa RM | Seperti E1 dengan kartu demo Ahmad (RM belum ada) | Layar menampilkan "Silakan ke admisi dulu". `cetak_antrean.arahan = admisi`. |
| E10 | Privasi | Sesudah E1–E9 | (a) Tidak ada file gambar atau audio baru di repo, `server/log`, atau temp OS (dicek dengan glob sebelum dan sesudah). (b) Log JSONL tidak berisi `data:image`, transkrip mentah, atau deret ≥4 digit selain di draf. (c) Penangkapan request ke Jev/Claude-teks tidak berisi deret ≥4 digit. (d) Semua audio yang diputar adalah file pra-render dari naskah, dan tidak ada TTS runtime. |
| E11 | Kode kios hanya membaca | `npm run cek` di root | Uji pemindaian endpoint tulis lulus untuk `sapa-flow/src`, `server/src/kios`, dan `web/src/kios`. tsc strict hijau di semua paket. |
| E12 | Tombol | Tekan F2 di keadaan mana pun dan F1 saat Sapa bicara | F2 → `diminta_pasien`. F1 → giliran terakhir diputar ulang tanpa mengubah keadaan. |

**Target ukuran** (dicatat, bukan syarat lulus, sampai laptop demo diukur):
- Respons setelah ujaran selesai sampai Sapa mulai bicara: kurang dari 1,5 detik online, kurang dari 3 detik offline (profil cpu).
- Animasi avatar minimal 30 fps.

## 8. Fase kerja (satu fase per sesi; `npm run cek` hijau sebelum lanjut)
1. **Server dan protokol:** workspaces, `server/kios` + `server/petugas`, WS + Zod, mock adapter + `dummy.json`, audit JSONL. Bukti: uji integrasi WS menjalankan E1 dengan pesan `ucapan`.
2. **Layar kios tanpa avatar:** subtitle, kartu, layar antrean, tombol, indikator lampu. Bukti: screenshot tiap keadaan.
3. **TTS pra-render dan avatar:** `tools/tts-render`, uji cakupan audio, Canvas mesh, pose, dan lip-sync. Bukti: rekaman layar giliran menyapa.
4. **STT online/offline:** Azure + Whisper + router + VAD. Bukti: E6 dan pengukuran latensi di laptop demo.
5. **Kamera, FRISTA mock, dan pemindai OCR:** MediaPipe, pemindaian otomatis, adapter Claude vision, kartu demo spesimen. Bukti: E2–E4.
6. **Dashboard petugas.** Bukti: E1, E4, E8 dari sisi dashboard.
7. **E2E dan naskah demo:** Playwright E1–E12 dan `e2e/DEMO.md`.

## 9. Data dummy dan bahan demo
- `server/data/dummy.json` minimal berisi: Siti (RM ada, FRISTA cocok), Ahmad (RM belum, FRISTA cocok), Budi (FRISTA dan sidik jari tidak cocok), Rina (peserta tidak aktif), dan satu booking hari ini untuk Siti. Semua NIK dan nomor kartu dibuat acak dan tidak berasal dari data nyata.
- **Kartu demo:** PDF bertanda besar "SPESIMEN – DATA FIKTIF – BUKAN DOKUMEN RESMI". Tata letaknya cukup mirip supaya OCR realistis, tapi tidak meniru desain resmi KTP-el atau kartu JKN (tanpa lambang negara, logo BPJS, atau fitur pengaman).
- Gambar layar Mobile JKN dummy juga bertanda spesimen.

## 10. Risiko dan hal terbuka
- **Spesifikasi laptop demo belum diketahui.** Latensi Whisper profil cpu bisa lebih dari 3 detik. Ukur di fase 4. Kalau terlalu lambat, pakai model `base` khusus mode offline.
- **Viseme Azure untuk id-ID belum dipastikan.** Cadangannya timeline dari vokal (4.4).
- **Pose avatar dari rotasi layer bisa terlihat janggal.** Cadangannya klip WebM per pose (4.6).
- **Akses Jev masih early access.** Jev dipanggil lewat gateway `api.experientiallabs.ai/v1/systemone` (klien native `sapa-flow/src/jev.ts`, model `jev-latest`, tanpa coba ulang karena panggilan bisa sudah ditagih). Tanpa `EXPERIENTIAL_API_KEY`, penilai turun ke Claude lalu kata kunci, tanpa perubahan kode. Latensi nyata gateway belum diukur; batas waktu awal 3 detik (`JEV_BATAS_WAKTU_MS`) dikalibrasi setelah panggilan live pertama.
- **Keyakinan OCR dari LLM tidak terkalibrasi.** Jelaskan ke juri bahwa ini indikatif.
- **Naskah baru** (mode, kode booking, sidik jari, arahan) masih draf dan perlu ditinjau tim sebelum dirender ke audio.
- **Kamera laptop tunggal:** demo pindai butuh peragaan yang rapi (dokumen didekatkan ke kamera).
- **Celah diketahui: Rujukan VClaim belum masuk alur.** Klien dan mock (`sapa-flow/src/bpjs/klien.ts`, `src/mock/`) sudah menyediakan Rujukan dan skenario "rujukan kedaluwarsa" serta "poli berbeda", tetapi mesin belum memakainya. Aturan yang akan dipasang: poli booking vs poli rujukan; tanpa booking, poli rujukan vs poli yang dipilih di kios. Dikerjakan sebagai fase tersendiri tepat sesudah Prompt 4.
- **Enkripsi `response` VClaim/Antrean** (`src/bpjs/kripto.ts`) mengikuti implementasi komunitas, belum diverifikasi terhadap katalog resmi BPJS.
