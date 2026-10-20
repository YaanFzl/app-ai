import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { BATAS, langkah, mulai, type Efek, type Keadaan, type Peristiwa } from "../src/mesin.js";
import { proses, type PeristiwaMentah } from "../src/sesi.js";
import { buatKios } from "../src/kios.js";
import type { Penilai } from "../src/pemahaman.js";
import type { HasilFrista, HasilSidikJari } from "../src/domain.js";
import { daftarOpsi, type Topik } from "../src/pertanyaan.js";
import { BOOKING_SITI, HARI_INI, KARTU_AHMAD, KARTU_SITI, penilaiPalsu, rujukanUntuk, type JawabJev } from "./palsu.js";

// ---------------------------------------------------------------- penilai palsu untuk skenario
const TABEL_JEV: Record<string, JawabJev> = {
  "pakai BPJS": { choice: "bpjs", confidence: 0.93 },
  "sudah booking di Mobile JKN": { choice: "checkin", confidence: 0.9 },
  "umum saja, bayar sendiri": { choice: "non_bpjs", confidence: 0.91 },
  "mau rawat inap": { choice: "admission", confidence: 0.9 },
  "iya boleh": { choice: "ya", confidence: 0.92 },
  nggak: { choice: "tidak", confidence: 0.9 },
  "kontrol rutin, Nak": { choice: "kontrol", confidence: 0.88 },
  "bawa surat dari puskesmas": { choice: "rujukan_baru", confidence: 0.91 },
  "kulo ajeng kontrol": { choice: "kontrol", confidence: 0.5 }, // nanggung → Claude
  betul: { choice: "ya", confidence: 0.95 },
  "ehm gimana ya": { choice: "tidak_jelas", confidence: 0.8 },
  "panggilkan suster saja": { choice: "tidak_jelas", confidence: 0.4, noul: 0.95 },
};
const penilaiStandar = () =>
  penilaiPalsu(
    (u) => TABEL_JEV[u] ?? { choice: "tidak_jelas", confidence: 0.9 },
    (u) => ({ opsi: u === "kulo ajeng kontrol" ? "kontrol" : "tidak_jelas", minta_petugas: false }),
  );

async function jalankan(urutan: PeristiwaMentah[], penilai: Penilai = penilaiStandar()) {
  let { berikut: s, efek } = mulai(HARI_INI);
  cekGiliran(s, efek);
  const semuaEfek: Efek[] = [...efek];
  const jalur: string[] = [s.tag];
  for (const pm of urutan) {
    const r = await proses(s, pm, penilai);
    s = r.berikut;
    cekGiliran(s, r.efek);
    semuaEfek.push(...r.efek);
    jalur.push(s.tag);
  }
  return { s, efek: semuaEfek, jalur };
}
const ucapan = (t: string): PeristiwaMentah => ({ tipe: "UCAPAN_PASIEN", transkrip: t });
const suratKontrol = (k = KARTU_SITI) => ({ ...rujukanUntuk(k), jenis: "surat_kontrol" as const });
const BPJS = ucapan("pakai BPJS");
const kartu = (identitas = KARTU_SITI, rm: "ada" | "belum" = "ada"): PeristiwaMentah => ({ tipe: "KARTU_TERBACA", identitas, rm });
const setuju: PeristiwaMentah = { tipe: "PETUGAS_SETUJU", nomorAntrean: "PD-017" };
const draf = (efek: readonly Efek[]) => efek.flatMap((e) => (e.efek === "kirim_draf_ke_petugas" ? [e.draf] : []));
const alasanPetugas = (efek: readonly Efek[]) => efek.flatMap((e) => (e.efek === "panggil_petugas" ? [e.alasan] : []));

// ---------------------------------------------------------------- skenario
test("skenario 1: alur bahagia lansia kontrol rutin → nomor antrean, arahan poli", async () => {
  const { s, efek, jalur } = await jalankan([
    BPJS,
    ucapan("iya boleh"),
    kartu(),
    { tipe: "FRISTA", hasil: { hasil: "cocok" } },
    ucapan("kontrol rutin, Nak"),
    { tipe: "DOKUMEN_TERBACA", dokumen: suratKontrol() },
    ucapan("betul"),
    setuju,
  ]);
  assert.deepEqual(jalur, ["TANYA_MODE", "SAPA_IZIN", "MINTA_KARTU", "VERIFIKASI_WAJAH", "TANYA_KUNJUNGAN", "SCAN_DOKUMEN", "KONFIRMASI_DATA", "MENUNGGU_PETUGAS_CEK", "SELESAI"]);
  assert.equal(s.tag === "SELESAI" && s.hasil, "antrean_dicetak");
  assert.equal(s.k.sapaan, "Ibu");
  assert.ok(efek.some((e) => e.efek === "cetak_antrean" && e.nomorAntrean === "PD-017" && e.arahan === "poli"));
  assert.ok(!efek.some((e) => e.efek === "audit" && e.catatan.jenis === "bendera"), "tidak ada bendera");
  assert.equal(draf(efek)[0]?.verifikasi, "wajah");
});

test("skenario 2: wajah gelap lalu terlalu jauh → kios memandu, lalu cocok", async () => {
  const { s, efek } = await jalankan([
    BPJS,
    ucapan("iya boleh"),
    kartu(KARTU_AHMAD),
    { tipe: "FRISTA", hasil: { hasil: "wajah_tidak_terdeteksi", sebab: "gelap" } },
    { tipe: "FRISTA", hasil: { hasil: "wajah_tidak_terdeteksi", sebab: "terlalu_jauh" } },
    { tipe: "FRISTA", hasil: { hasil: "cocok" } },
  ]);
  assert.equal(s.tag, "TANYA_KUNJUNGAN");
  assert.ok(efek.some((e) => e.efek === "kamera" && e.aksi === "naikkan_eksposur"));
  const sub = efek.flatMap((e) => (e.efek === "bicara" ? [e.giliran.subtitle] : []));
  assert.ok(sub.includes("Lampu diterangkan. Lihat ke kamera lagi"));
  assert.ok(sub.includes("Sedikit maju… tahan sebentar"));
});

test("skenario 3: FRISTA tidak cocok dua kali → sidik jari ditawarkan, BUKAN petugas langsung", async () => {
  const { s, efek, jalur } = await jalankan([
    BPJS,
    ucapan("iya boleh"),
    kartu(),
    { tipe: "FRISTA", hasil: { hasil: "tidak_cocok" } },
    { tipe: "FRISTA", hasil: { hasil: "tidak_cocok" } },
    { tipe: "SIDIK_JARI", hasil: { hasil: "cocok" } },
  ]);
  assert.equal(jalur.at(-2), "VERIFIKASI_SIDIK_JARI");
  assert.equal(s.tag, "TANYA_KUNJUNGAN");
  assert.equal(s.k.verifikasi, "sidik_jari");
  assert.deepEqual(alasanPetugas(efek), []);
  assert.equal(efek.filter((e) => e.efek === "audit" && e.catatan.jenis === "frista").length, 2);
  const sub = efek.flatMap((e) => (e.efek === "bicara" ? [e.giliran.ucapan as string] : []));
  assert.ok(sub.at(-1)?.startsWith("Sidik jari sudah cocok"));
});

test("skenario 4: izin ditolak → petugas melayani; kios tidak menyentuh kartu", async () => {
  const { s, efek } = await jalankan([BPJS, ucapan("nggak")]);
  assert.equal(s.tag === "MEMANGGIL_PETUGAS" && s.alasan, "izin_ditolak");
  assert.ok(!efek.some((e) => e.efek === "lampu" && e.target === "pemindai" && e.nyala));
  assert.ok(efek.some((e) => e.efek === "audit" && e.catatan.jenis === "izin" && !e.catatan.diberikan));
});

test("skenario 5: dua kali tidak jelas → petugas (tidak ada loop tanpa akhir)", async () => {
  const { s, efek } = await jalankan([ucapan("ehm gimana ya"), ucapan("ehm gimana ya")]);
  assert.equal(s.tag === "MEMANGGIL_PETUGAS" && s.alasan, "jawaban_tidak_jelas");
  const sub = efek.flatMap((e) => (e.efek === "bicara" ? [e.giliran.subtitle] : []));
  assert.deepEqual(sub, ["Pakai BPJS, kode booking Mobile JKN, atau bukan BPJS?", "BPJS, kode booking, atau bukan BPJS?", "Petugas segera datang membantu"]);
});

test("skenario 6: pasien minta petugas di tengah alur", async () => {
  const { s } = await jalankan([BPJS, ucapan("iya boleh"), kartu(), { tipe: "FRISTA", hasil: { hasil: "cocok" } }, ucapan("panggilkan suster saja")]);
  assert.equal(s.tag === "MEMANGGIL_PETUGAS" && s.alasan, "diminta_pasien");
});

test("skenario 7: nama di rujukan beda & kedaluwarsa → bendera, layar menandai ragu", async () => {
  const { s, efek } = await jalankan([
    BPJS,
    ucapan("iya boleh"),
    kartu(),
    { tipe: "FRISTA", hasil: { hasil: "cocok" } },
    ucapan("bawa surat dari puskesmas"),
    { tipe: "DOKUMEN_TERBACA", dokumen: rujukanUntuk(KARTU_SITI, { nama: "Sri Wahyuni", berlakuSampai: "2026-09-01" }) },
  ]);
  assert.equal(s.tag, "KONFIRMASI_DATA");
  const kolom = s.k.bendera.map((b) => b.kolom).sort();
  assert.deepEqual(kolom, ["nama", "rujukan_kedaluwarsa"]);
  const kartuLayar = efek.find((e) => e.efek === "tampilkan_kartu");
  assert.ok(kartuLayar && kartuLayar.efek === "tampilkan_kartu" && kartuLayar.isi.baris.find((b) => b.label === "Nama")?.ragu);
});

test("skenario 8: Jev nanggung + Claude setuju (bahasa Jawa) → diterima", async () => {
  const p = penilaiStandar();
  const { s } = await jalankan([BPJS, ucapan("iya boleh"), kartu(KARTU_AHMAD), { tipe: "FRISTA", hasil: { hasil: "cocok" } }, ucapan("kulo ajeng kontrol")], p);
  assert.equal(s.tag, "SCAN_DOKUMEN");
  assert.equal(s.k.kunjungan, "kontrol");
  assert.equal(p.reqClaude.length, 1, "Claude hanya dipanggil sekali, saat nanggung");
});

test("skenario 9: Jev & Claude terputus → mode kata kunci, lalu petugas bila tetap tak jelas", async () => {
  const p = penilaiPalsu(() => "galat", () => "galat");
  const { s, jalur } = await jalankan(
    [ucapan("pakai bpjs"), ucapan("iya, monggo"), kartu(KARTU_AHMAD), { tipe: "FRISTA", hasil: { hasil: "cocok" } }, ucapan("hmm"), ucapan("hmm")],
    p,
  );
  assert.equal(jalur[1], "SAPA_IZIN", "‘pakai bpjs’ dipahami kata kunci");
  assert.equal(jalur[2], "MINTA_KARTU", "‘iya, monggo’ dipahami kata kunci");
  assert.equal(s.tag === "MEMANGGIL_PETUGAS" && s.alasan, "layanan_ai_terputus");
});

test("skenario 10: angka dalam ucapan disamarkan sebelum dikirim ke Jev & Claude", async () => {
  const p = penilaiPalsu(
    (u) => (u === "pakai BPJS" ? { choice: "bpjs", confidence: 0.9 } : u === "iya boleh" ? { choice: "ya", confidence: 0.9 } : { choice: "kontrol", confidence: 0.5 }),
    () => ({ opsi: "kontrol", minta_petugas: false }),
  );
  await jalankan([BPJS, ucapan("iya boleh"), kartu(), { tipe: "FRISTA", hasil: { hasil: "cocok" } }, ucapan("kontrol, nomor saya 0001234567890")], p);
  const terkirim = JSON.stringify([...p.reqJev, ...p.reqClaude]);
  assert.ok(!/\d{4,}/.test(terkirim.replace(/"(input|output)_tokens":\d+/g, "")), "tidak ada deret angka keluar dari kios");
  assert.ok(terkirim.includes("[angka]"));
});

test("skenario 11: keluhan darurat di tengah pertanyaan → petugas SEGERA, menang atas jawaban", async () => {
  const p = penilaiPalsu(
    (u) => (u.includes("sesak") ? { choice: "bpjs", confidence: 0.9, darurat: 0.85 } : { choice: "bpjs", confidence: 0.9 }),
    () => ({ opsi: "bpjs", minta_petugas: false }),
  );
  const { s, efek } = await jalankan([ucapan("BPJS, tapi saya sesak dari tadi")], p);
  assert.equal(s.tag === "MEMANGGIL_PETUGAS" && s.alasan, "kemungkinan_darurat");
  assert.ok(efek.some((e) => e.efek === "panggil_petugas" && e.prioritas === "segera"));
  assert.ok(!efek.some((e) => e.efek === "lampu" && e.target === "pemindai" && e.nyala), "tidak lanjut minta kartu");
});

test("skenario 12: darurat saat sudah menunggu petugas biasa → prioritas dinaikkan", () => {
  let s = mulai(HARI_INI).berikut;
  s = langkah(s, { tipe: "TOMBOL_PETUGAS" }).berikut;
  const r = langkah(s, { tipe: "JAWABAN", topik: "izin", hasil: { jenis: "darurat" } });
  assert.ok(r.efek.some((e) => e.efek === "panggil_petugas" && e.prioritas === "segera"));
});

test("skenario 13: check-in kode booking → verifikasi wajah → konfirmasi data booking → nomor antrean", async () => {
  const { s, efek, jalur } = await jalankan([
    ucapan("sudah booking di Mobile JKN"),
    ucapan("iya boleh"),
    { tipe: "KODE_BOOKING_TERBACA", identitas: KARTU_SITI, booking: BOOKING_SITI, rm: "ada" },
    { tipe: "FRISTA", hasil: { hasil: "cocok" } },
    ucapan("betul"),
    setuju,
  ]);
  assert.deepEqual(jalur, ["TANYA_MODE", "SAPA_IZIN", "MINTA_KODE_BOOKING", "VERIFIKASI_WAJAH", "KONFIRMASI_DATA", "MENUNGGU_PETUGAS_CEK", "SELESAI"]);
  assert.equal(s.tag === "SELESAI" && s.hasil, "antrean_dicetak");
  const layar = efek.find((e) => e.efek === "tampilkan_kartu");
  assert.ok(layar && layar.efek === "tampilkan_kartu" && layar.isi.baris.some((b) => b.label === "Jam praktik" && b.nilai === "08:00-12:00"));
  const d = draf(efek)[0];
  assert.equal(d?.mode, "checkin");
  assert.equal(d?.sumberKolom["poliTujuan"], "booking");
});

test("skenario 14: Non BPJS → petugas langsung; izin tidak ditanya, kartu tidak disentuh", async () => {
  const { s, efek, jalur } = await jalankan([ucapan("umum saja, bayar sendiri")]);
  assert.deepEqual(jalur, ["TANYA_MODE", "MEMANGGIL_PETUGAS"]);
  assert.equal(s.tag === "MEMANGGIL_PETUGAS" && s.alasan, "non_bpjs");
  assert.ok(!efek.some((e) => e.efek === "audit" && e.catatan.jenis === "izin"));
  assert.ok(!efek.some((e) => e.efek === "lampu" && e.nyala));
});

test("skenario 15: Admission → petugas dengan alasan sendiri (bukan non_bpjs)", async () => {
  const { s } = await jalankan([ucapan("mau rawat inap")]);
  assert.equal(s.tag === "MEMANGGIL_PETUGAS" && s.alasan, "admission");
});

test("skenario 16: wajah dan sidik jari gagal → petugas; alasan membedakan tidak cocok vs tak terbaca", async () => {
  const awal = [BPJS, ucapan("iya boleh"), kartu()];
  const takTerdeteksi: PeristiwaMentah = { tipe: "FRISTA", hasil: { hasil: "wajah_tidak_terdeteksi", sebab: "gelap" } };

  const teknis = await jalankan([...awal, takTerdeteksi, takTerdeteksi, takTerdeteksi, { tipe: "SIDIK_JARI", hasil: { hasil: "tidak_terbaca" } }, { tipe: "SIDIK_JARI", hasil: { hasil: "tidak_terbaca" } }]);
  assert.equal(teknis.s.tag === "MEMANGGIL_PETUGAS" && teknis.s.alasan, "verifikasi_tak_terbaca");
  assert.equal(teknis.efek.filter((e) => e.efek === "audit" && e.catatan.jenis === "sidik_jari").length, 2);

  const curiga = await jalankan([
    ...awal,
    { tipe: "FRISTA", hasil: { hasil: "tidak_cocok" } },
    { tipe: "FRISTA", hasil: { hasil: "tidak_cocok" } },
    { tipe: "SIDIK_JARI", hasil: { hasil: "tidak_terbaca" } },
    { tipe: "SIDIK_JARI", hasil: { hasil: "tidak_terbaca" } },
  ]);
  assert.equal(curiga.s.tag === "MEMANGGIL_PETUGAS" && curiga.s.alasan, "verifikasi_tidak_cocok", "tidak cocok di wajah tetap terbawa");
});

test("skenario 17: pasien BPJS belum punya RM → tetap dilayani Sapa, arahan ke admisi", async () => {
  const { s, efek } = await jalankan([
    BPJS,
    ucapan("iya boleh"),
    kartu(KARTU_AHMAD, "belum"),
    { tipe: "FRISTA", hasil: { hasil: "cocok" } },
    ucapan("kontrol rutin, Nak"),
    { tipe: "DOKUMEN_TERBACA", dokumen: suratKontrol(KARTU_AHMAD) },
    ucapan("betul"),
    setuju,
  ]);
  assert.equal(s.tag === "SELESAI" && s.hasil, "antrean_dicetak");
  assert.ok(efek.some((e) => e.efek === "cetak_antrean" && e.arahan === "admisi"));
  const terakhir = efek.filter((e) => e.efek === "bicara").at(-1);
  assert.ok(terakhir?.efek === "bicara" && terakhir.giliran.subtitle.includes("admisi"));
});

test("skenario 18: WAKTU_HABIS → petugas; diabaikan bila petugas sudah memeriksa", async () => {
  const tengah = await jalankan([BPJS, ucapan("iya boleh"), { tipe: "WAKTU_HABIS" }]);
  assert.equal(tengah.s.tag === "MEMANGGIL_PETUGAS" && tengah.s.alasan, "waktu_habis");

  const cek = await jalankan([BPJS, ucapan("iya boleh"), kartu(), { tipe: "FRISTA", hasil: { hasil: "cocok" } }, ucapan("kontrol rutin, Nak"), { tipe: "DOKUMEN_TERBACA", dokumen: suratKontrol() }, ucapan("betul"), { tipe: "WAKTU_HABIS" }]);
  assert.equal(cek.s.tag, "MENUNGGU_PETUGAS_CEK");
});

// ---------------------------------------------------------------- properti (acak, ribuan alur)
// Opsi selalu milik topiknya sendiri (sama seperti keluaran `pahami`).
const arbHasil = (topik: Topik) =>
  fc.oneof(
    fc.record({
      jenis: fc.constant("pasti" as const),
      opsi: fc.constantFrom(...daftarOpsi(topik)),
      sumber: fc.constantFrom("jev" as const, "jev+claude" as const, "claude" as const, "kata_kunci" as const),
    }),
    fc.record({ jenis: fc.constant("tanya_ulang" as const), sebab: fc.constantFrom("tidak_jelas" as const, "ragu" as const, "beda_pendapat" as const, "layanan_terputus" as const) }),
    fc.constant({ jenis: "minta_petugas" as const }),
    fc.constant({ jenis: "darurat" as const }),
  );
const arbPeristiwa: fc.Arbitrary<Peristiwa> = fc.oneof(
  fc
    .constantFrom<Topik>("mode", "izin", "kunjungan", "konfirmasi")
    .chain((topik) => arbHasil(topik).map((hasil) => ({ tipe: "JAWABAN", topik, hasil }) as Peristiwa)),
  fc
    .tuple(fc.constantFrom(KARTU_SITI, KARTU_AHMAD, { ...KARTU_AHMAD, statusPeserta: "tidak_aktif" as const }), fc.constantFrom("ada" as const, "belum" as const))
    .chain(([identitas, rm]) =>
      fc.constantFrom<Peristiwa>({ tipe: "KARTU_TERBACA", identitas, rm }, { tipe: "KODE_BOOKING_TERBACA", identitas, booking: BOOKING_SITI, rm }),
    ),
  fc.constantFrom<Peristiwa>(
    { tipe: "KARTU_GAGAL" }, { tipe: "KODE_BOOKING_GAGAL" }, { tipe: "DOKUMEN_GAGAL" }, { tipe: "TOMBOL_ULANGI" }, { tipe: "TOMBOL_PETUGAS" }, { tipe: "DIAM" },
    { tipe: "WAKTU_HABIS" }, { tipe: "PETUGAS_DATANG" }, { tipe: "PETUGAS_SELESAI" }, { tipe: "PETUGAS_SETUJU", nomorAntrean: "A-001" }, { tipe: "PETUGAS_AMBIL_ALIH" },
    { tipe: "FRISTA", hasil: { hasil: "cocok" } }, { tipe: "FRISTA", hasil: { hasil: "tidak_cocok" } },
    { tipe: "FRISTA", hasil: { hasil: "wajah_tidak_terdeteksi", sebab: "gelap" } }, { tipe: "FRISTA", hasil: { hasil: "wajah_tidak_terdeteksi", sebab: "tertutup" } },
    { tipe: "SIDIK_JARI", hasil: { hasil: "cocok" } }, { tipe: "SIDIK_JARI", hasil: { hasil: "tidak_cocok" } }, { tipe: "SIDIK_JARI", hasil: { hasil: "tidak_terbaca" } },
  ),
  fc.record({ nama: fc.constantFrom("Siti Aminah", "Sitti Aminah", "Budi"), exp: fc.constantFrom("2026-12-31", "2026-01-01"), yakin: fc.double({ min: 0.5, max: 1, noNaN: true }) })
    .map(({ nama, exp, yakin }) => ({ tipe: "DOKUMEN_TERBACA" as const, dokumen: rujukanUntuk(KARTU_SITI, { nama, berlakuSampai: exp }, yakin) })),
);

/** Keadaan yang hanya boleh dicapai setelah identitas terverifikasi (wajah ATAU sidik jari). */
const SESUDAH_VERIFIKASI: readonly string[] = ["TANYA_KUNJUNGAN", "SCAN_DOKUMEN", "KONFIRMASI_DATA", "MENUNGGU_PETUGAS_CEK"];

function cekGiliran(s: Keadaan, efek: readonly Efek[]) {
  for (const e of efek) {
    if (e.efek !== "bicara") continue;
    const { ucapan, subtitle } = e.giliran;
    assert.ok(subtitle.length <= 64, `subtitle terlalu panjang: ${subtitle}`);
    assert.ok(!/\d{4,}/.test(ucapan), "ucapan berisi deret angka");
    assert.ok(!/struk/i.test(ucapan + subtitle), "naskah masih menyebut struk");
    for (const k of [KARTU_SITI, KARTU_AHMAD]) {
      assert.ok(!ucapan.includes(k.nama) && !ucapan.includes(k.nik), "ucapan menyebut data pribadi");
    }
    assert.ok(!ucapan.includes(BOOKING_SITI.kodeBooking) && !ucapan.includes(BOOKING_SITI.nomorAntrean), "ucapan menyebut kode booking / nomor antrean");
  }
  if (s.k.identitas) assert.ok(s.k.izin, "kartu diproses sebelum izin");
  if (SESUDAH_VERIFIKASI.includes(s.tag) || (s.tag === "SELESAI" && s.hasil === "antrean_dicetak")) {
    assert.ok(s.k.verifikasi, `${s.tag} dicapai tanpa verifikasi`);
  }
  for (const e of efek) if (e.efek === "cetak_antrean") assert.ok(s.k.verifikasi, "nomor antrean tanpa verifikasi");
}

/** Peristiwa yang "diharapkan" keadaan saat ini → alur acak sering sampai akhir, bukan macet di awal. */
function harapan(s: Keadaan, pilih: number): Peristiwa {
  const ya = { jenis: "pasti", opsi: "ya", sumber: "jev" } as const;
  const daftar: Peristiwa[] = (() => {
    switch (s.tag) {
      case "TANYA_MODE": return [
        { tipe: "JAWABAN", topik: "mode", hasil: { jenis: "pasti", opsi: "bpjs", sumber: "jev" } },
        { tipe: "JAWABAN", topik: "mode", hasil: { jenis: "pasti", opsi: "checkin", sumber: "jev" } },
      ];
      case "SAPA_IZIN": return [{ tipe: "JAWABAN", topik: "izin", hasil: ya }];
      case "MINTA_KARTU": return [{ tipe: "KARTU_TERBACA", identitas: KARTU_SITI, rm: "ada" }, { tipe: "KARTU_TERBACA", identitas: KARTU_AHMAD, rm: "belum" }];
      case "MINTA_KODE_BOOKING": return [{ tipe: "KODE_BOOKING_TERBACA", identitas: KARTU_SITI, booking: BOOKING_SITI, rm: "ada" }];
      // tidak_cocok ikut "diharapkan" supaya cabang sidik jari benar-benar terjelajah.
      case "VERIFIKASI_WAJAH": return [{ tipe: "FRISTA", hasil: { hasil: "cocok" } }, { tipe: "FRISTA", hasil: { hasil: "tidak_cocok" } }];
      case "VERIFIKASI_SIDIK_JARI": return [{ tipe: "SIDIK_JARI", hasil: { hasil: "cocok" } }];
      case "TANYA_KUNJUNGAN": return [
        { tipe: "JAWABAN", topik: "kunjungan", hasil: { jenis: "pasti", opsi: "kontrol", sumber: "jev" } },
        { tipe: "JAWABAN", topik: "kunjungan", hasil: { jenis: "pasti", opsi: "rujukan_baru", sumber: "jev+claude" } },
      ];
      case "SCAN_DOKUMEN": return [{ tipe: "DOKUMEN_TERBACA", dokumen: rujukanUntuk(s.k.identitas ?? KARTU_SITI) }];
      case "KONFIRMASI_DATA": return [{ tipe: "JAWABAN", topik: "konfirmasi", hasil: ya }];
      case "MENUNGGU_PETUGAS_CEK": return [{ tipe: "PETUGAS_SETUJU", nomorAntrean: "A-001" }, { tipe: "PETUGAS_AMBIL_ALIH" }];
      case "MEMANGGIL_PETUGAS": return [{ tipe: "PETUGAS_DATANG" }, { tipe: "PETUGAS_SELESAI" }];
      case "SELESAI": return [{ tipe: "TOMBOL_ULANGI" }];
    }
  })();
  return daftar[pilih % daftar.length]!;
}
const arbLangkah = fc.tuple(fc.integer({ min: 0, max: 9 }), arbPeristiwa, fc.nat());

test("properti: 3.000 alur acak tidak pernah crash, tidak mengucapkan data pribadi, izin lebih dulu, dan tidak melewati verifikasi", () => {
  const akhir = { antrean_dicetak: 0, dilayani_petugas: 0 };
  const lewatSidikJari = { n: 0 };
  fc.assert(
    fc.property(fc.array(arbLangkah, { maxLength: 40 }), (urutan) => {
      let r = mulai(HARI_INI);
      cekGiliran(r.berikut, r.efek);
      for (const [dadu, acak, pilih] of urutan) {
        const p = dadu < 7 ? harapan(r.berikut, pilih) : acak; // 70% kooperatif, 30% kacau
        r = langkah(r.berikut, p);
        cekGiliran(r.berikut, r.efek);
        for (const e of r.efek) {
          if (e.efek === "kirim_draf_ke_petugas" && e.draf.identitas) assert.ok(r.berikut.k.izin);
          if (e.efek === "panggil_petugas") assert.ok(r.efek.some((x) => x.efek === "audit" && x.catatan.jenis === "eskalasi"), "eskalasi tanpa audit");
        }
      }
      if (r.berikut.tag === "SELESAI") akhir[r.berikut.hasil]++;
      if (r.berikut.k.verifikasi === "sidik_jari") lewatSidikJari.n++;
    }),
    { numRuns: 3000 },
  );
  // Generator harus benar-benar menjelajah kedua akhir dan cabang sidik jari; kalau tidak, properti di atas tidak berarti.
  assert.ok(akhir.antrean_dicetak > 100 && akhir.dilayani_petugas > 100, JSON.stringify(akhir));
  assert.ok(lewatSidikJari.n > 10, `cabang sidik jari jarang terjelajah: ${lewatSidikJari.n}`);
});

test("properti: dari keadaan mana pun, pasien yang diam selalu sampai ke petugas, lalu selesai dilayani", () => {
  fc.assert(
    fc.property(fc.array(arbPeristiwa, { maxLength: 40 }), (awalan) => {
      let s = mulai(HARI_INI).berikut;
      for (const p of awalan) s = langkah(s, p).berikut;
      for (let i = 0; i < BATAS.tanyaUlang; i++) s = langkah(s, { tipe: "DIAM" }).berikut;
      assert.ok(["MEMANGGIL_PETUGAS", "MENUNGGU_PETUGAS_CEK", "SELESAI"].includes(s.tag), `macet di ${s.tag}`);
      s = langkah(s, { tipe: "PETUGAS_DATANG" }).berikut;
      s = langkah(s, { tipe: "PETUGAS_SELESAI" }).berikut;
      s = langkah(s, { tipe: "PETUGAS_AMBIL_ALIH" }).berikut;
      assert.equal(s.tag, "SELESAI");
      assert.ok(s.tag === "SELESAI" && (s.hasil === "antrean_dicetak" || s.hasil === "dilayani_petugas"));
    }),
    { numRuns: 3000 },
  );
});

// ---------------------------------------------------------------- verifikasi: oracle dari peristiwa, bukan dari flag mesin
/** "Verifikasi lolos" = FRISTA cocok diterima di VERIFIKASI_WAJAH, atau sidik jari cocok di VERIFIKASI_SIDIK_JARI. */
const lolosVerifikasi = (s: Keadaan, p: Peristiwa) =>
  (s.tag === "VERIFIKASI_WAJAH" && p.tipe === "FRISTA" && p.hasil.hasil === "cocok") ||
  (s.tag === "VERIFIKASI_SIDIK_JARI" && p.tipe === "SIDIK_JARI" && p.hasil.hasil === "cocok");
/** Penyerang: setiap hasil verifikasi diganti salah satu jenis gagal; peristiwa lain (termasuk PETUGAS_SETUJU di keadaan mana pun) tetap. */
const GAGAL_WAJAH: readonly HasilFrista[] = [
  { hasil: "tidak_cocok" }, { hasil: "wajah_tidak_terdeteksi", sebab: "gelap" }, { hasil: "wajah_tidak_terdeteksi", sebab: "terlalu_jauh" },
];
const GAGAL_JARI: readonly HasilSidikJari[] = [{ hasil: "tidak_cocok" }, { hasil: "tidak_terbaca" }];
const tanpaCocok = (p: Peristiwa, pilih: number): Peristiwa =>
  p.tipe === "FRISTA" && p.hasil.hasil === "cocok" ? { tipe: "FRISTA", hasil: GAGAL_WAJAH[pilih % GAGAL_WAJAH.length]! }
  : p.tipe === "SIDIK_JARI" && p.hasil.hasil === "cocok" ? { tipe: "SIDIK_JARI", hasil: GAGAL_JARI[pilih % GAGAL_JARI.length]! }
  : p;

test("properti: tidak ada urutan peristiwa yang sampai ke antrean_dicetak tanpa verifikasi lolos atas identitas yang sama", () => {
  const jelajah = { dicetak: 0, sampaiSidikJari: 0, wajahTakTerdeteksiBatas: 0 };
  for (const curang of [false, true]) {
    fc.assert(
      fc.property(fc.array(arbLangkah, { maxLength: 40 }), (urutan) => {
        let s = mulai(HARI_INI).berikut;
        let terverifikasi: Keadaan["k"]["identitas"] | undefined; // identitas saat verifikasi lolos
        for (const [dadu, acak, pilih] of urutan) {
          const asli = dadu < 7 ? harapan(s, pilih) : acak;
          const p = curang ? tanpaCocok(asli, pilih) : asli;
          if (lolosVerifikasi(s, p)) terverifikasi = s.k.identitas;
          if (s.tag === "VERIFIKASI_SIDIK_JARI") jelajah.sampaiSidikJari++;
          if (s.tag === "VERIFIKASI_WAJAH" && s.percobaan >= BATAS.wajahTakTerdeteksi && p.tipe === "FRISTA" && p.hasil.hasil === "wajah_tidak_terdeteksi") jelajah.wajahTakTerdeteksiBatas++;
          const r = langkah(s, p);
          s = r.berikut;
          const dicetak = r.efek.some((e) => e.efek === "cetak_antrean") || (s.tag === "SELESAI" && s.hasil === "antrean_dicetak");
          if (dicetak) {
            jelajah.dicetak++;
            assert.ok(!curang, "antrean dicetak padahal tidak ada verifikasi yang lolos");
            assert.ok(terverifikasi !== undefined, "antrean dicetak tanpa verifikasi lolos");
            assert.deepEqual(s.k.identitas, terverifikasi, "identitas berubah setelah verifikasi");
          }
        }
      }),
      { numRuns: 3000 },
    );
  }
  // Generator harus benar-benar mencapai akhir dan memaksa cabang sidik jari; kalau tidak, properti kosong.
  assert.ok(jelajah.dicetak > 100 && jelajah.sampaiSidikJari > 100 && jelajah.wajahTakTerdeteksiBatas > 50, JSON.stringify(jelajah));
});

// ---------------------------------------------------------------- kios terkunci selama petugas dipanggil
test("properti: tidak ada sesi baru yang bisa dimulai selama MEMANGGIL_PETUGAS; hanya PETUGAS_SELESAI yang membukanya", () => {
  let terkunci = 0;
  fc.assert(
    fc.property(fc.array(arbLangkah, { maxLength: 40 }), (urutan) => {
      const pegang = { s: mulai(HARI_INI).berikut };
      const kios = buatKios(() => ({ keadaan: () => pegang.s }));
      const pertama = kios.mulaiSesi();
      assert.ok(pertama);
      for (const [dadu, acak, pilih] of urutan) {
        const sebelum = pegang.s;
        if (sebelum.tag === "MEMANGGIL_PETUGAS") {
          terkunci++;
          assert.equal(kios.mulaiSesi(), null, "sesi baru dimulai saat petugas dipanggil");
          assert.equal(kios.aktif(), pertama);
        }
        const p = dadu < 7 ? harapan(sebelum, pilih) : acak;
        pegang.s = langkah(sebelum, p).berikut;
        if (sebelum.tag === "MEMANGGIL_PETUGAS" && p.tipe !== "PETUGAS_SELESAI") assert.equal(pegang.s.tag, "MEMANGGIL_PETUGAS", `${p.tipe} membuka kunci`);
      }
      if (pegang.s.tag === "SELESAI") assert.notEqual(kios.mulaiSesi(), null, "kios tetap terkunci setelah selesai");
    }),
    { numRuns: 3000 },
  );
  assert.ok(terkunci > 300, `MEMANGGIL_PETUGAS jarang terjelajah: ${terkunci}`);
});
