1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.
2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

# APP AI (kios pendaftaran RS dengan avatar Sapa)
Prototype Healthkathon BPJS 2026. Tidak ada data peserta riil; semua data fiktif.

## Aturan yang tidak boleh dilanggar
- Inti alur ada di sapa-flow/ (state machine bertipe). Jangan menulis alur paralel; perluas mesin itu.
- Kios tidak pernah menolak pasien. Hasil akhir hanya antrean_dicetak atau dilayani_petugas.
- Nama, NIK, nomor kartu, dan poli tidak boleh diucapkan TTS (tipe Ucapan). Hanya tampil di layar.
- AI tidak menulis ke SIMRS/BPJS. Paling jauh: draf ke dashboard petugas.
- FRISTA, sidik jari, VClaim, HFIS, Antrean (kode booking), dan SIMRS selalu lewat adapter dengan versi mock.

## Batasan integrasi BPJS
Sumber: materi resmi workshop BPJS.
- Posisi: kios adalah "Konsol" di tahap pendaftaran alur Antrean Online. Target tahap pendaftaran ±10 menit; satu sesi Sapa harus selesai jauh di bawah itu. Runner sesi mencatat durasi setiap sesi (mulai sampai SELESAI) di log audit.
- Batas waktu (nilai awal, dikalibrasi saat pilot; disimpan di konfigurasi, bukan tersebar di kode):
  - Per giliran 30 detik: ulang pertanyaan sekali, lalu panggil petugas.
  - Per sesi 5 menit: panggil petugas dengan alasan `waktu_habis`.
  - Runner yang menghitung waktu dan mengirim peristiwa `WAKTU_HABIS` ke mesin. Mesin tetap murni (tanpa jam).
- Mode konsol: BPJS, Non BPJS, Check-in (kode booking Mobile JKN), Admission. Sapa menangani BPJS dan Check-in. Non BPJS langsung ke petugas (alasan `non_bpjs`). Admission langsung ke petugas (alasan `admission`, terpisah dari `non_bpjs`).
- Verifikasi: FRISTA (wajah) dan sidik jari adalah dua opsi setara. Wajah gagal: tawarkan sidik jari. Keduanya gagal: panggil petugas. Tidak boleh ada jalur yang melewati verifikasi, termasuk Check-in, karena SEP tidak lagi ditandatangani pasien.
- Arahan akhir: pasien yang sudah punya RM diarahkan ke poli; yang belum ke admisi. Pasien BPJS tanpa RM tetap dilayani Sapa sampai SELESAI (beda dengan mode Admission). Status RM dibaca dari SIMRS (baca saja).
- Kios hanya membaca: VClaim Peserta, Rujukan, Rencana Kontrol; jadwal dokter (HFIS); kode booking Antrean; hasil FRISTA.
- Endpoint tulis DILARANG ada di kode kios: SEP insert/update/delete, pengajuanSEP, aprovalSEP, Rujukan insert/update, RencanaKontrol insert/update/delete/SPRI, antrean add/updatewaktu/batal.
- Data minimal: jangan pernah meminta atau menyimpan diagnosa, riwayat pelayanan (I-Care), rincian iuran, atau foto. Skema Zod harus sempit; pakai `z.object` bawaan supaya kolom lain dibuang saat parsing (jangan `.passthrough()`, jangan `.strict()`).
- Frame kamera (deteksi wajah lokal untuk mock FRISTA) hanya diproses di memori. Jangan simpan gambar ke disk atau log.
- Semua data peserta di repo adalah dummy buatan tim. Kunci hanya di .env.

## Perintah
- Cek semua: `npm run cek` di sapa-flow (tsc strict + uji). Wajib hijau sebelum commit.
- TypeScript strict di semua paket.

## Gaya kerja
- Satu fase per sesi. Tulis rencana dulu untuk perubahan lebih dari 2 file.
- Tunjukkan bukti (output tes/screenshot), bukan klaim "sudah selesai".