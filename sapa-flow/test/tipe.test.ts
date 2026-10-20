/**
 * Tes TIPE: dicek oleh `tsc`, bukan saat runtime.
 * Setiap `@ts-expect-error` WAJIB memicu error; bila suatu hari kode berubah sehingga
 * baris itu lolos kompilasi, `tsc` gagal ("Unused @ts-expect-error"). Jaminan ini terkunci.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BookingSchema, IdentitasKartuSchema } from "../src/domain.js";
import type { HasilAkhir, Keadaan } from "../src/mesin.js";
import { ucap } from "../src/ucapan.js";
import { BOOKING_SITI, KARTU_SITI } from "./palsu.js";

type Sama<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const pastikan = <T extends true>() => {};

test("tipe: kios tidak punya hasil 'ditolak'", () => {
  pastikan<Sama<HasilAkhir, "antrean_dicetak" | "dilayani_petugas">>();
  // Tidak ada tag keadaan yang menandakan penolakan.
  pastikan<Sama<Extract<Keadaan["tag"], `${string}TOLAK${string}`>, never>>();
});

test("tipe: data pribadi tidak bisa masuk ucapan TTS", () => {
  const tidakDipanggil = () => {
    // @ts-expect-error nama pasien (Pribadi<"Nama">) tidak boleh diucapkan
    ucap`Selamat pagi, ${KARTU_SITI.nama}`;
    // @ts-expect-error NIK tidak boleh diucapkan
    ucap`NIK Anda ${KARTU_SITI.nik}`;
    // @ts-expect-error string bebas pun ditolak; hanya Sapaan atau angka 1..3
    ucap`Poli ${"penyakit_dalam"}`;
    ucap`Selamat pagi, ${"Ibu"}`; // sapaan: boleh
  };
  void tidakDipanggil;
});

test("tipe: antrean_dicetak wajib membawa nomor antrean dari petugas", () => {
  const tidakDipanggil = (s: Keadaan): Keadaan => {
    // @ts-expect-error nomorAntrean wajib; kios tidak membuat nomor sendiri ("antrean add" dilarang)
    const selesai: Keadaan = { tag: "SELESAI", k: s.k, hasil: "antrean_dicetak" };
    return selesai;
  };
  void tidakDipanggil;
});

test("data minimal: kolom asing (diagnosa, riwayat, iuran) dibuang saat parsing", () => {
  const kotor = { diagnosa: "I10", riwayatPelayanan: ["x"], iuran: 42000 };
  const b = BookingSchema.parse({ ...BOOKING_SITI, ...kotor });
  const k = IdentitasKartuSchema.parse({ ...KARTU_SITI, ...kotor });
  for (const o of [b, k]) for (const kolom of Object.keys(kotor)) assert.ok(!(kolom in o), `${kolom} lolos`);
});

test("tipe: string biasa tidak bisa menyamar sebagai NIK", () => {
  const tidakDipanggil = (): typeof KARTU_SITI => ({
    ...KARTU_SITI,
    // @ts-expect-error harus lewat NikSchema (validasi 16 digit)
    nik: "1234",
  });
  void tidakDipanggil;
});
