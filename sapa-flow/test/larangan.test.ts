/** Larangan arsitektur kode kios (`npm run cek:larangan`; juga ikut `npm run cek`). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const SRC = new URL("../src/", import.meta.url);
const BERKAS = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.replaceAll("\\", "/"));
const isi = (f: string) => readFileSync(new URL(f, SRC), "utf8");
/** Komentar dibuang: dokumentasi boleh menyebut kolom yang DIBUANG, kode tidak boleh memuatnya. */
const tanpaKomentar = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ponytail: pemindaian teks; path yang dirakit dari potongan string ("SEP/" + v + "/insert") lolos. Tinjauan kode tetap perlu.
/** Endpoint tulis BPJS (CLAUDE.md), dengan atau tanpa segmen versi ("2.0/"). */
const ENDPOINT_TULIS = [
  /SEP\/([\w.]+\/)?(insert|update|delete)/i, /pengajuanSEP/i, /aprovalSEP/i,
  /Rujukan\/([\w.]+\/)?(insert|update|delete)/i,
  /RencanaKontrol\/([\w.]+\/)?(insert|update|delete)/i, /(insert|update)SPRI/i, /\bSPRI\b/,
  /antrean\/(add|updatewaktu|batal)/i,
];
const KATA_SKEMA = /diagnos|foto/i;

test("pola larangan sendiri benar: menangkap path tulis, tidak menangkap path baca", () => {
  const tulis = [
    "SEP/2.0/insert", "SEP/2.0/update", "SEP/2.0/delete", "SEP/insert", "Sep/pengajuanSEP", "Sep/aprovalSEP",
    "Rujukan/2.0/insert", "Rujukan/2.0/Update", "Rujukan/delete", "Rujukan/Khusus/insert",
    "RencanaKontrol/insert", "RencanaKontrol/v2/Update", "RencanaKontrol/Delete", "RencanaKontrol/InsertSPRI", "RencanaKontrol/UpdateSPRI",
    "antrean/add", "antrean/updatewaktu", "antrean/batal",
  ];
  const baca = [
    "Peserta/nokartu/x/tglSEP/y", "Peserta/nik/x/tglSEP/y", "Rujukan/Peserta/x", "Rujukan/x",
    "RencanaKontrol/noSuratKontrol/x", "jadwaldokter/kodepoli/x/tanggal/y", "antrean/pendaftaran/kodebooking/x",
  ];
  for (const p of tulis) assert.ok(ENDPOINT_TULIS.some((r) => r.test(p)), `lolos: ${p}`);
  for (const p of baca) assert.ok(!ENDPOINT_TULIS.some((r) => r.test(p)), `salah tangkap: ${p}`);
  assert.ok(KATA_SKEMA.test(tanpaKomentar(`/** dibuang: diagnosa */ const S = z.object({ foto: z.string() });`)));
  assert.ok(!KATA_SKEMA.test(tanpaKomentar(`/** dibuang: diagnosa, foto */ const S = z.object({}); // diagnosa`)));
});

test("kode kios tidak memuat endpoint tulis BPJS (SEP, Rujukan, RencanaKontrol, antrean)", () => {
  for (const f of BERKAS) for (const pola of ENDPOINT_TULIS) assert.ok(!pola.test(isi(f)), `${f} memuat ${pola}`);
});

test("skema (berkas yang memakai zod) tidak memuat kata diagnosa/foto di luar komentar", () => {
  const skema = BERKAS.filter((f) => /from\s+["']zod["']/.test(isi(f)));
  assert.ok(skema.includes("bpjs/skema.ts") && skema.includes("domain.ts"), `berkas skema tak terdeteksi: ${skema}`);
  for (const f of skema) {
    const m = tanpaKomentar(isi(f)).match(KATA_SKEMA);
    assert.ok(!m, `${f} memuat "${m?.[0]}"`);
  }
});

test("kode kios tidak mengimpor src/mock (hanya test/ dan demo yang boleh)", () => {
  const IMPOR_MOCK = /(from|import)\s*\(?\s*["'][^"']*\bmock\//;
  for (const f of BERKAS.filter((f) => !f.startsWith("mock/"))) assert.ok(!IMPOR_MOCK.test(isi(f)), `${f} mengimpor src/mock`);
});

test("Jev hanya lewat gateway: tidak ada SDK / origin penyedia di kode kios", () => {
  for (const f of BERKAS) {
    const t = isi(f);
    assert.ok(!/@typesafe-ai\/sdk|api\.typesafe\.ai|TYPESAFE_API_KEY/.test(t), `${f} memakai SDK/origin penyedia Jev`);
    if (f !== "jev.ts") assert.ok(!t.includes("experientiallabs.ai"), `${f} memanggil gateway Jev di luar jev.ts`);
  }
});
