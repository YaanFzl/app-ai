/**
 * Evaluasi pemahaman pada set ujaran berlabel.
 *  - Selalu: baseline kata kunci (tanpa AI, offline).
 *  - Bila EXPERIENTIAL_API_KEY ada: Jev saja (lewat gateway; setiap ujaran = satu panggilan berbayar).
 *  - Bila keduanya ada: kebijakan lengkap Jev + Claude.
 * Keluaran: akurasi, laju "aman" (salah tapi bertanya ulang/memanggil petugas), dan
 * SALAH-YAKIN (salah sekaligus diterima) — metrik yang paling penting untuk kios; total dan per state.
 * Lalu durasi sesi per skenario mock (estimasi jam simulasi, lihat eval/durasi.ts) terhadap
 * batas sesi Sapa 5 menit dan target tahap pendaftaran BPJS ±10 menit.
 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { klienJevDariEnv } from "../src/jev.js";
import { buatPenilaiClaude, buatPenilaiJev, nilaiKataKunci, pahami, type Penilai } from "../src/pemahaman.js";
import type { Topik } from "../src/pertanyaan.js";
import { samarkan } from "../src/samarkan.js";
import { PERTANYAAN } from "../src/pertanyaan.js";
import { TOPIK_KEADAAN } from "../src/mesin.js";
import { WAKTU } from "../src/sesi.js";
import { MODEL_WAKTU, simulasiDurasi } from "./durasi.js";

interface Kasus { topik: Topik; ujaran: string; label: string }
const { kasus } = JSON.parse(readFileSync(new URL("./ujaran-lansia.json", import.meta.url), "utf8")) as { kasus: Kasus[] };
const PERTANYAAN_KIOS: Record<Topik, string> = {
  mode: "Pakai BPJS, kode booking Mobile JKN, atau bukan BPJS?",
  izin: "Data dipakai untuk daftar hari ini. Boleh? Ya / tidak",
  kunjungan: "Kontrol, atau bawa rujukan baru?",
  konfirmasi: "Data di layar sudah betul? Jawab: ya / tidak",
};

type Keluaran = string; // opsi | tidak_jelas | minta_petugas
interface Ringkas { n: number; benar: number; salahAman: number; salahYakin: number; daruratTerlewat: number; ms: number[] }

function catat(r: Ringkas, label: string, keluar: Keluaran, ms: number) {
  r.n++;
  r.ms.push(ms);
  if (keluar === label) r.benar++;
  else if (label === "darurat") { r.salahYakin++; r.daruratTerlewat++; } // darurat yang terlewat selalu dihitung berbahaya
  else if (keluar === "tidak_jelas" || keluar === "minta_petugas" || keluar === "darurat") r.salahAman++;
  else r.salahYakin++;
}
const baru = (): Ringkas => ({ n: 0, benar: 0, salahAman: 0, salahYakin: 0, daruratTerlewat: 0, ms: [] });

/** Total + satu ringkasan per state (topik pertanyaan = state yang menunggu jawaban lisan). */
const STATE: Record<Topik, string> = Object.fromEntries(Object.entries(TOPIK_KEADAAN).map(([tag, topik]) => [topik, tag])) as Record<Topik, string>;
type PerState = { total: Ringkas; per: Record<Topik, Ringkas> };
const baruPerState = (): PerState => ({ total: baru(), per: Object.fromEntries(Object.keys(PERTANYAAN).map((t) => [t, baru()])) as Record<Topik, Ringkas> });
function catatKasus(r: PerState, c: Kasus, keluar: Keluaran, ms: number) {
  catat(r.total, c.label, keluar, ms);
  catat(r.per[c.topik], c.label, keluar, ms);
}

function baris(nama: string, r: Ringkas) {
  if (r.n === 0) return `${nama.padEnd(24)} (tidak ada ujaran berlabel)`;
  const ms = [...r.ms].sort((a, b) => a - b);
  const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]?.toFixed(0) ?? "-";
  return `${nama.padEnd(24)} n ${String(r.n).padStart(3)} | benar ${((100 * r.benar) / r.n).toFixed(1).padStart(5)}%  | salah-aman ${String(r.salahAman).padStart(2)} | SALAH-YAKIN ${String(r.salahYakin).padStart(2)} | darurat terlewat ${r.daruratTerlewat} | p50 ${p(0.5)} ms, p95 ${p(0.95)} ms`;
}
function cetak(nama: string, r: PerState) {
  console.log(`\n${nama}`);
  console.log(baris("  Total", r.total));
  for (const t of Object.keys(PERTANYAAN) as Topik[]) console.log(baris(`  ${STATE[t]}`, r.per[t]));
}

const menitDetik = (d: number) => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}`;

async function durasiSkenario() {
  const hasil = await simulasiDurasi(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }));
  const batasSesi = WAKTU.sesiMs / 1000;
  console.log(`\nDurasi sesi per skenario mock (ESTIMASI jam simulasi, bukan ukuran; asumsi di eval/durasi.ts MODEL_WAKTU)`);
  console.log(`  Asumsi: jawab ${MODEL_WAKTU.jawabLisan} dtk, pindai ${MODEL_WAKTU.pindai} dtk, petugas cek ${MODEL_WAKTU.petugasCek} dtk, datang ${MODEL_WAKTU.petugasDatang} dtk, melayani ${MODEL_WAKTU.petugasMelayani} dtk`);
  for (const h of hasil) {
    const d = h.detik;
    const tanda = d === null ? "TIDAK SELESAI" : `${d < 300 ? "<5" : "  "} ${d < 600 ? "<10" : "   "}`;
    const petugas = h.detikPetugas > 0 ? ` (di tangan petugas ${menitDetik(h.detikPetugas)})` : "";
    console.log(`  ${h.nama.padEnd(42)} ${String(h.hasil ?? "-").padEnd(17)} ${d === null ? "-" : menitDetik(d).padStart(5)}  ${tanda}${petugas}`);
  }
  const selesai = hasil.filter((h) => h.detik !== null);
  const kurang = (dtk: number) => selesai.filter((h) => h.detik! < dtk).length;
  console.log(`\n  Selesai di bawah 5 menit : ${kurang(300)}/${hasil.length}`);
  console.log(`  Selesai di bawah 10 menit: ${kurang(600)}/${hasil.length}`);
  if (selesai.length < hasil.length) console.log(`  Tidak sampai SELESAI     : ${hasil.length - selesai.length}`);
  // Jam runner berhenti saat petugas memegang sesi; sisanya (bagian kios) yang dibatasi WAKTU_HABIS.
  const lewatBatasKios = selesai.filter((h) => h.detik! - h.detikPetugas >= batasSesi);
  console.log(`  Bagian kios ≥ batas sesi ${batasSesi / 60} menit (akan memicu WAKTU_HABIS): ${lewatBatasKios.length}${lewatBatasKios.length ? ` (${lewatBatasKios.map((h) => h.nama).join(", ")})` : ""}`);
}

async function main() {
  const kk = baruPerState();
  for (const c of kasus) {
    const t0 = performance.now();
    const k = nilaiKataKunci(c.topik, samarkan(c.ujaran));
    catatKasus(kk, c, k.darurat ? "darurat" : k.mintaPetugas ? "minta_petugas" : k.opsi, performance.now() - t0);
  }
  console.log(`Set: ${kasus.length} ujaran, ${Object.keys(PERTANYAAN).length} pertanyaan`);
  cetak("Kata kunci (tanpa AI)", kk);

  const klienJev = klienJevDariEnv();
  const punyaClaude = !!process.env.ANTHROPIC_API_KEY;
  const jev = klienJev ? buatPenilaiJev(klienJev) : null;
  const claude = punyaClaude ? buatPenilaiClaude(new Anthropic()) : null;
  const penilai: [string, Penilai][] = [
    ...(jev ? [["Jev saja", { jev, claude: null }] as [string, Penilai]] : []),
    ...(jev && claude ? [["Jev + Claude", { jev, claude }] as [string, Penilai]] : []),
  ];
  if (!jev) console.log("\n(EXPERIENTIAL_API_KEY tidak ada: Jev dilewati. Isi kunci di .env lalu jalankan `npm run eval` lagi.)");
  for (const [nama, p] of penilai) {
    const r = baruPerState();
    for (const c of kasus) {
      const t0 = performance.now();
      const { hasil } = await pahami(c.topik, { pertanyaanKios: PERTANYAAN_KIOS[c.topik], ujaran: samarkan(c.ujaran) }, p);
      const keluar = hasil.jenis === "pasti" ? hasil.opsi : hasil.jenis === "tanya_ulang" ? "tidak_jelas" : hasil.jenis;
      catatKasus(r, c, keluar, performance.now() - t0);
    }
    cetak(nama, r);
  }

  await durasiSkenario();
}
main().catch((e) => { console.error(e); process.exit(1); });
