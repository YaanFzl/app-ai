import { writeFileSync } from "node:fs";
import { mulai, type Keadaan, type Pandu } from "../src/mesin.js";
import { giliranUntuk } from "../src/naskah.js";
import { ALASAN_PETUGAS } from "../src/domain.js";
import { BOOKING_SITI, KARTU_SITI } from "../test/palsu.js";
const k0 = mulai("2026-10-12").berikut.k;
const kb = { ...k0, mode: "bpjs" as const };
const k = { ...kb, izin: true, identitas: KARTU_SITI, sapaan: "Ibu" as const, rm: "ada" as const, verifikasi: "wajah" as const };
const v: [string, Keadaan][] = [
  ["pertama", { tag: "TANYA_MODE", k: k0 }],
  ["diulang", { tag: "TANYA_MODE", k: { ...k0, ulang: 1 } }],
  ["pertama", { tag: "SAPA_IZIN", k: kb }],
  ["diulang", { tag: "SAPA_IZIN", k: { ...kb, ulang: 1 } }],
  ["pertama", { tag: "MINTA_KARTU", k: { ...kb, izin: true }, percobaan: 1 }],
  ["gagal baca", { tag: "MINTA_KARTU", k: { ...kb, izin: true }, percobaan: 2 }],
  ["pertama", { tag: "MINTA_KODE_BOOKING", k: { ...k0, mode: "checkin", izin: true }, percobaan: 1 }],
  ["gagal baca", { tag: "MINTA_KODE_BOOKING", k: { ...k0, mode: "checkin", izin: true }, percobaan: 2 }],
  ...(["awal", "terang", "maju", "lepas_penutup", "ulang"] as Pandu[]).map((p): [string, Keadaan] => [p.replace("_", " "), { tag: "VERIFIKASI_WAJAH", k: { ...k, verifikasi: null }, percobaan: 1, tidakCocok: 0, pandu: p }]),
  ["pertama", { tag: "VERIFIKASI_SIDIK_JARI", k: { ...k, verifikasi: null }, percobaan: 1, adaTidakCocok: false }],
  ["gagal baca", { tag: "VERIFIKASI_SIDIK_JARI", k: { ...k, verifikasi: null }, percobaan: 2, adaTidakCocok: false }],
  ["pertama (wajah)", { tag: "TANYA_KUNJUNGAN", k }],
  ["pertama (sidik jari)", { tag: "TANYA_KUNJUNGAN", k: { ...k, verifikasi: "sidik_jari" } }],
  ["diulang", { tag: "TANYA_KUNJUNGAN", k: { ...k, ulang: 1 } }],
  ["kontrol", { tag: "SCAN_DOKUMEN", k: { ...k, kunjungan: "kontrol" }, percobaan: 1 }],
  ["rujukan baru", { tag: "SCAN_DOKUMEN", k: { ...k, kunjungan: "rujukan_baru" }, percobaan: 1 }],
  ["gagal baca", { tag: "SCAN_DOKUMEN", k: { ...k, kunjungan: "kontrol" }, percobaan: 2 }],
  ["pertama", { tag: "KONFIRMASI_DATA", k }],
  ["check-in", { tag: "KONFIRMASI_DATA", k: { ...k, mode: "checkin", booking: BOOKING_SITI } }],
  ["diulang", { tag: "KONFIRMASI_DATA", k: { ...k, ulang: 1 } }],
  ["", { tag: "MENUNGGU_PETUGAS_CEK", k }],
  ...ALASAN_PETUGAS.map((a): [string, Keadaan] => [a.replace(/_/g, " "), { tag: "MEMANGGIL_PETUGAS", k, alasan: a, datang: false }]),
  ["petugas datang", { tag: "MEMANGGIL_PETUGAS", k, alasan: "diminta_pasien", datang: true }],
  ["nomor antrean, ke poli", { tag: "SELESAI", k, hasil: "antrean_dicetak", nomorAntrean: "PD-017" }],
  ["nomor antrean, ke admisi", { tag: "SELESAI", k: { ...k, rm: "belum" }, hasil: "antrean_dicetak", nomorAntrean: "PD-017" }],
  ["dilayani petugas", { tag: "SELESAI", k, hasil: "dilayani_petugas" }],
];
writeFileSync("naskah.json", JSON.stringify(v.map(([varian, s]) => ({ keadaan: s.tag, varian, ...giliranUntuk(s) }))));
console.log(v.length);
