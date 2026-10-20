import { test } from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import {
  BookingAntreanSchema,
  HasilFristaSchema,
  HasilSidikJariSchema,
  JadwalDokterSchema,
  PesertaVclaimSchema,
  RencanaKontrolSchema,
  RujukanVclaimSchema,
  StatusRmSchema,
} from "../src/bpjs/skema.js";
import { BOOKING_SITI, KARTU_SITI } from "./palsu.js";

// ---------------------------------------------------------------- respons mentah fiktif (bukan data peserta riil)
const PESERTA = {
  peserta: {
    noKartu: KARTU_SITI.nomorKartu,
    nik: KARTU_SITI.nik,
    nama: KARTU_SITI.nama,
    tglLahir: KARTU_SITI.tanggalLahir,
    sex: "P",
    statusPeserta: { kode: "0", keterangan: "AKTIF" },
    mr: { noMR: "123456", noTelepon: "081200000000" },
    hakKelas: { kode: "3", keterangan: "KELAS III" },
  },
};
const RUJUKAN = {
  rujukan: {
    noKunjungan: "0301R0011026B000017",
    tglKunjungan: "2026-10-01",
    poliRujukan: { kode: "INT", nama: "PENYAKIT DALAM" },
    keluhan: "pusing",
    diagnosa: { kode: "I10", nama: "Essential (primary) hypertension" },
  },
};
const RENCANA_KONTROL = {
  noSuratKontrol: "0301R0011026K000017",
  tglRencanaKontrol: "2026-10-12",
  poliTujuan: "INT",
  sep: { noSep: "0301R0011026V000017", diagnosa: "I10 - Essential (primary) hypertension" },
};
const JADWAL = [{ kodedokter: 12345, namadokter: "dr. Fiktif", kodepoli: "INT", jadwal: "08:00-12:00", libur: 0 }];
const BOOKING = [
  {
    kodebooking: BOOKING_SITI.kodeBooking,
    tanggal: BOOKING_SITI.tanggalPeriksa,
    kodepoli: "INT",
    jampraktek: BOOKING_SITI.jamPraktik,
    noantrean: BOOKING_SITI.nomorAntrean,
    nokapst: KARTU_SITI.nomorKartu,
    nik: KARTU_SITI.nik,
    nohp: "081200000000",
    norekammedis: "123456",
  },
];

const { sumber: _sumber, ...pesertaSiti } = KARTU_SITI;
const KASUS: [string, z.ZodTypeAny, unknown, unknown][] = [
  ["VClaim Peserta", PesertaVclaimSchema, PESERTA, pesertaSiti],
  ["VClaim Rujukan", RujukanVclaimSchema, RUJUKAN, { poli: "penyakit_dalam", berlakuSampai: "2026-12-30" }],
  ["Rencana Kontrol", RencanaKontrolSchema, RENCANA_KONTROL, { poli: "penyakit_dalam", tanggal: "2026-10-12" }],
  ["Jadwal dokter", JadwalDokterSchema, JADWAL, [{ jamPraktik: "08:00-12:00", libur: false }]],
  ["Kode booking", BookingAntreanSchema, BOOKING, { nomorKartu: KARTU_SITI.nomorKartu, booking: BOOKING_SITI }],
  ["FRISTA", HasilFristaSchema, { hasil: "cocok" }, { hasil: "cocok" }],
  ["Sidik jari", HasilSidikJariSchema, { hasil: "cocok" }, { hasil: "cocok" }],
  ["Status RM", StatusRmSchema, { adaRm: true, noRm: "123456" }, "ada"],
];

/** Tambah kolom diagnosa di tingkat atas (atau di tiap butir bila respons berupa daftar). */
const tambahDiagnosa = (r: unknown) =>
  Array.isArray(r) ? r.map((b) => ({ ...b, diagnosa: "I10" })) : { ...(r as object), diagnosa: "I10" };

for (const [nama, skema, respons, harapan] of KASUS) {
  test(`data minimal: ${nama} berisi diagnosa tetap lolos, diagnosa hilang dari hasil`, () => {
    const hasil = skema.parse(tambahDiagnosa(respons));
    const teks = JSON.stringify(hasil);
    assert.ok(!teks.includes("diagnosa") && !teks.includes("I10"), `diagnosa lolos: ${teks}`);
    assert.deepEqual(hasil, harapan);
  });
}

test("pemetaan: kode poli asing jadi 'lainnya', status peserta selain kode 0 jadi tidak_aktif", () => {
  assert.equal(RencanaKontrolSchema.parse({ ...RENCANA_KONTROL, poliTujuan: "XYZ" }).poli, "lainnya");
  const p = PesertaVclaimSchema.parse({ peserta: { ...PESERTA.peserta, statusPeserta: { kode: "1" } } });
  assert.equal(p.statusPeserta, "tidak_aktif");
});
