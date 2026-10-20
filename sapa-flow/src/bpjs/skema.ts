/**
 * Skema respons sistem eksternal yang dibaca kios (baca saja).
 *
 * Masukan: isi `response` mentah (amplop metaData dan dekripsi diurus adapter).
 * Keluaran: tipe domain yang dipakai mesin. Semua memakai `z.object` bawaan, jadi kolom
 * lain (diagnosa, keluhan, telepon, nomor RM, hak kelas, jenis peserta, SEP) dibuang saat parsing.
 *
 * TODO verifikasi nama kolom VClaim v2 / WS Antrean RS terhadap materi workshop BPJS.
 */
import { z } from "zod";
import { BookingSchema, IdentitasKartuSchema, NomorKartuSchema, type Poli, type StatusRm } from "../domain.js";

/** FRISTA dan sidik jari tidak punya format publik; mock memakai bentuk domain langsung. */
export { HasilFristaSchema, HasilSidikJariSchema } from "../domain.js";

const Tanggal = z.string().date();

export const KODE_POLI: Record<string, Poli> = {
  INT: "penyakit_dalam",
  JAN: "jantung",
  SAR: "saraf",
  MAT: "mata",
  PAR: "paru",
  BED: "bedah",
};
/** Kode poli asing jadi "lainnya", bukan galat: kios tidak menolak pasien, petugas yang melihat. */
const PoliBpjs = z.string().transform((kode): Poli => KODE_POLI[kode] ?? "lainnya");

/** VClaim Peserta. `sumber` (kartu JKN / KTP) diisi runner dari jenis kartu yang dipindai. */
export const PesertaVclaimSchema = z
  .object({
    peserta: z.object({
      noKartu: z.string(),
      nik: z.string(),
      nama: z.string(),
      tglLahir: z.string(),
      sex: z.string(),
      statusPeserta: z.object({ kode: z.string() }),
    }),
  })
  .transform(({ peserta: p }) => ({
    nik: p.nik,
    nomorKartu: p.noKartu,
    nama: p.nama,
    tanggalLahir: p.tglLahir,
    jenisKelamin: p.sex,
    // TODO verifikasi: kode "0" = AKTIF.
    statusPeserta: p.statusPeserta.kode === "0" ? "aktif" : "tidak_aktif",
  }))
  .pipe(IdentitasKartuSchema.omit({ sumber: true }));

/** Rujukan FKTP berlaku 90 hari sejak tanggal kunjungan. */
const BERLAKU_RUJUKAN_HARI = 90;

/** VClaim Rujukan. Disiapkan, belum dipakai alur. */
export const RujukanVclaimSchema = z
  .object({
    rujukan: z.object({
      tglKunjungan: Tanggal,
      poliRujukan: z.object({ kode: PoliBpjs }),
    }),
  })
  .transform(({ rujukan: r }): { poli: Poli; berlakuSampai: string } => {
    const d = new Date(`${r.tglKunjungan}T00:00:00Z`);
    // ponytail: +90 hari eksklusif/inklusif belum dipastikan; kalibrasi saat pilot.
    d.setUTCDate(d.getUTCDate() + BERLAKU_RUJUKAN_HARI);
    return { poli: r.poliRujukan.kode, berlakuSampai: d.toISOString().slice(0, 10) };
  });

/** VClaim Rencana Kontrol (cari per nomor surat kontrol). Disiapkan, belum dipakai alur. */
export const RencanaKontrolSchema = z
  .object({ tglRencanaKontrol: Tanggal, poliTujuan: PoliBpjs })
  .transform((r): { poli: Poli; tanggal: string } => ({ poli: r.poliTujuan, tanggal: r.tglRencanaKontrol }));

/** Jadwal dokter HFIS (per poli per tanggal). */
export const JadwalDokterSchema = z.array(
  z
    .object({ jadwal: BookingSchema.shape.jamPraktik, libur: z.number() })
    .transform((j) => ({ jamPraktik: j.jadwal, libur: j.libur !== 0 })),
);

/** Antrean: pendaftaran per kode booking Mobile JKN. */
export const BookingAntreanSchema = z
  .array(
    z.object({
      kodebooking: z.string(),
      tanggal: z.string(),
      kodepoli: PoliBpjs,
      jampraktek: z.string(),
      noantrean: z.string(),
      nokapst: z.string(),
    }),
  )
  .nonempty()
  .transform(([b]) => ({
    nomorKartu: b.nokapst,
    booking: {
      kodeBooking: b.kodebooking,
      nomorAntrean: b.noantrean,
      poli: b.kodepoli,
      tanggalPeriksa: b.tanggal,
      jamPraktik: b.jampraktek,
    },
  }))
  .pipe(z.object({ nomorKartu: NomorKartuSchema, booking: BookingSchema }));

/** Status RM dari SIMRS (format mock kita; SIMRS tiap RS berbeda). Nomor RM tidak dibawa. */
export const StatusRmSchema = z
  .object({ adaRm: z.boolean() })
  .transform((r): StatusRm => (r.adaRm ? "ada" : "belum"));
