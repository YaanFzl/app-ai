import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { DrafPendaftaran } from "../src/mesin.js";
import { OPSI_BAWAAN } from "../src/mock/demo.js";
import { jalankanDashboardDemo } from "../src/mock/dashboard-demo.js";
import { pesanDariEfek, ringkasDraf, type KePetugas } from "../src/petugas/kontrak.js";
import type { CatatanAuditPetugas } from "../src/petugas/server.js";
import { BOOKING_SITI, HARI_INI, KARTU_SITI, rujukanUntuk } from "./palsu.js";

const PIN = "4826";
/** Nilai string berisi 13+ digit = NIK / nomor kartu utuh (angka `mulai` bukan string, jadi tidak ikut). */
function nomorUtuh(json: string): string | undefined {
  let ketemu: string | undefined;
  JSON.parse(json, (_k, v) => (typeof v === "string" && /\d{13,}/.test(v) ? (ketemu = v) : v));
  return ketemu;
}
const nomorUtuhSse = (teks: string) => teks.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => nomorUtuh(b.slice(6))).find(Boolean);

// ---------------------------------------------------------------- kontrak
const draf = (ubah: Partial<DrafPendaftaran>): DrafPendaftaran => ({
  mode: "bpjs",
  identitas: KARTU_SITI,
  verifikasi: "wajah",
  kunjungan: "kontrol",
  dokumen: rujukanUntuk(KARTU_SITI, { nama: "Sitti Aminah", berlakuSampai: "2026-10-01" }),
  booking: null,
  rm: "ada",
  bendera: [],
  sumberKolom: {},
  ...ubah,
});

test("kontrak: hanya kolom ragu yang membawa nilai, kartu vs dokumen; NIK disamarkan kecuali 4 digit terakhir", () => {
  const d = draf({ bendera: [{ kolom: "nama", kemiripan: 0.93 }, { kolom: "nik" }, { kolom: "rujukan_kedaluwarsa" }, { kolom: "ocr_ragu", kolomRagu: "nama" }] });
  assert.deepEqual(ringkasDraf(d), [
    { kolom: "nama", kartu: "Siti Aminah", dokumen: "Sitti Aminah" },
    { kolom: "nik", kartu: "************0001", dokumen: "************0001" },
    { kolom: "berlakuSampai", kartu: null, dokumen: "2026-10-01" },
  ]);
  const pesan = JSON.stringify(pesanDariEfek("7f1c7a2e-0d4b-4c8a-9a51-2a1f3c5e6d70", { efek: "kirim_draf_ke_petugas", draf: d }));
  assert.equal(nomorUtuh(pesan), undefined, pesan);
  for (const tak of ["1955-01-01", "penyakit_dalam", "kartu_jkn", "surat_kontrol"]) assert.ok(!pesan.includes(tak), `${tak} bocor: ${pesan}`);
});

test("kontrak: draf tanpa kolom ragu tidak membawa nilai apa pun", () => {
  assert.deepEqual(ringkasDraf(draf({ dokumen: null, booking: BOOKING_SITI })), []);
});

// ---------------------------------------------------------------- dashboard ujung ke ujung (HTTP + SSE)
async function bukaSse(base: string, cookie: string) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/peristiwa`, { headers: { cookie }, signal: ctrl.signal });
  const baca = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const pesan: KePetugas[] = [];
  let teks = "";
  let sisa = "";
  /** Satu `read()` yang belum selesai dipakai ulang; kalau dibuang saat kalah balapan, potongannya hilang. */
  let tertunda: Promise<ReadableStreamReadResult<string>> | null = null;
  async function tunggu(cocok: (p: KePetugas) => boolean, ms = 5000): Promise<KePetugas> {
    const batas = Date.now() + ms;
    for (;;) {
      const ada = pesan.find(cocok);
      if (ada) return ada;
      if (Date.now() > batas) throw new Error(`pesan tidak datang; diterima: ${teks}`);
      tertunda ??= baca.read();
      const r = await Promise.race([tertunda, new Promise<null>((ok) => setTimeout(() => ok(null), 50))]);
      if (!r) continue;
      tertunda = null;
      const { value, done } = r;
      if (done) throw new Error("SSE tertutup");
      teks += value;
      const potong = (sisa + value).split("\n\n");
      sisa = potong.pop() ?? "";
      for (const blok of potong) if (blok.startsWith("data: ")) pesan.push(JSON.parse(blok.slice(6)));
    }
  }
  return { tunggu, teks: () => teks, tutup: () => ctrl.abort() };
}

test("dashboard: PIN, kartu draf + panggilan, tombol Setuju / Saya datang / Selesai, kios terkunci, audit tanpa nilai", async () => {
  const audit: CatatanAuditPetugas[] = [];
  const demo = await jalankanDashboardDemo({
    pin: PIN,
    hariIni: HARI_INI,
    catatAudit: (c) => audit.push(c),
    skenario: [{ ...OPSI_BAWAAN, dokumen: "ragu" }, { ...OPSI_BAWAAN, peserta: "budi", wajah: "tidakcocok", sidikjari: "tidakcocok" }],
  });
  await new Promise<void>((r) => demo.dashboard.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(demo.dashboard.server.address() as AddressInfo).port}`;
  const sse: { tutup: () => void }[] = [];
  try {
    // Tanpa login: halaman masuk saja; data dan aksi ditolak.
    assert.match(await (await fetch(base)).text(), /name="pin"/);
    assert.equal((await fetch(`${base}/peristiwa`)).status, 401);
    assert.equal((await fetch(`${base}/aksi`, { method: "POST" })).status, 401);
    const masuk = (pin: string) =>
      fetch(`${base}/masuk`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ pin, nama: "Rani" }) });
    assert.equal((await masuk("0000")).status, 401);
    const ok = await masuk(PIN);
    assert.equal(ok.status, 303);
    const cookie = ok.headers.get("set-cookie")!.split(";")[0]!;
    const aksi = (t: string, idSesi: string) =>
      fetch(`${base}/aksi`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ t, idSesi }) }).then((r) => r.status);

    const a = await bukaSse(base, cookie);
    sse.push(a);

    // Skenario 1: draf menunggu cek dengan kolom ragu (nilai kartu vs dokumen).
    const cek = await a.tunggu((p) => p.t === "sesi" && p.tag === "MENUNGGU_PETUGAS_CEK");
    const d = await a.tunggu((p) => p.t === "draf" && p.idSesi === cek.idSesi);
    assert.ok(d.t === "draf");
    assert.deepEqual(d.kolomRagu.map((r) => r.kolom), ["nama", "berlakuSampai"]);
    assert.deepEqual(d.kolomRagu[0], { kolom: "nama", kartu: "Siti Aminah", dokumen: "Siti Rahmawati" });
    assert.equal(await aksi("bukan_aksi", cek.idSesi), 400);
    assert.equal(await aksi("datang", cek.idSesi), 409, "Saya datang tidak berlaku untuk draf menunggu cek");
    assert.equal(await aksi("setuju", cek.idSesi), 204);
    await a.tunggu((p) => p.t === "sesi" && p.idSesi === cek.idSesi && p.tag === "SELESAI");

    // Skenario 2: panggilan verifikasi tidak cocok; kios terkunci sampai Selesai.
    const panggil = await a.tunggu((p) => p.t === "panggil" && p.alasan === "verifikasi_tidak_cocok");
    assert.equal(demo.kios.mulaiSesi(), null);
    assert.equal(await aksi("datang", panggil.idSesi), 204);
    await a.tunggu((p) => p.t === "sesi" && p.idSesi === panggil.idSesi && p.petugasDatang);
    assert.equal(demo.kios.mulaiSesi(), null, "kios terbuka hanya karena petugas datang");
    assert.equal(await aksi("selesai", panggil.idSesi), 204);

    const hasil = await demo.selesai;
    assert.deepEqual(hasil.map((h) => h.hasil), ["antrean_dicetak", "dilayani_petugas"]);
    assert.equal(nomorUtuhSse(a.teks()), undefined, "NIK / nomor kartu utuh terkirim ke dashboard");

    // Nilai hanya di memori selama sesi: klien baru tidak menerima apa pun setelah semua sesi selesai.
    const b = await bukaSse(base, cookie);
    sse.push(b);
    await assert.rejects(b.tunggu(() => true, 200));

    assert.deepEqual(audit.map((c) => [c.keputusan, c.petugas, c.kolomRagu]), [
      ["setuju", "Rani", ["nama", "berlakuSampai"]],
      ["datang", "Rani", []],
      ["selesai", "Rani", []],
    ]);
    // Nama, NIK (3273…), nomor kartu (000123…), tanggal: tidak boleh ada. idSesi (UUID acak) boleh berisi digit.
    const tanpaId = JSON.stringify(audit.map(({ waktu: _w, idSesi: _i, ...c }) => c));
    assert.ok(!/Siti|Aminah|Rahmawati|\d{4,}/.test(tanpaId), `audit memuat nilai: ${tanpaId}`);
  } finally {
    for (const s of sse) s.tutup();
    demo.dashboard.server.closeAllConnections();
    demo.dashboard.server.close();
    demo.tutup();
  }
});
