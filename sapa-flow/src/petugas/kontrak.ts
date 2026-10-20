/**
 * Kontrak data kios ↔ dashboard petugas. Bentuk pesan sama dengan rencana WebSocket di SPEC 5,
 * jadi pindah ke web/ (React + WS) cukup ganti tampilan dan transport (sekarang SSE + POST).
 *
 * Data minimal: dashboard TIDAK menerima draf utuh. Nilai hanya dikirim untuk kolom yang ditandai ragu,
 * kartu vs dokumen berdampingan, dan NIK / nomor kartu disamarkan kecuali 4 digit terakhir.
 */
import { z } from "zod";
import { ALASAN_PETUGAS, samarkanNomor, type BenderaData } from "../domain.js";
import type { DrafPendaftaran, Efek, Keadaan } from "../mesin.js";

const IdSesi = z.string().uuid();

export const KolomRaguSchema = z.object({
  kolom: z.string(),
  kartu: z.string().nullable(),
  dokumen: z.string().nullable(),
});
export type KolomRagu = z.infer<typeof KolomRaguSchema>;

export const KePetugasSchema = z.discriminatedUnion("t", [
  /** Status sesi; `tag` SELESAI = kartu dibuang dari dashboard (dan dari memori). */
  z.object({ t: z.literal("sesi"), idSesi: IdSesi, tag: z.string(), mulai: z.number(), petugasDatang: z.boolean() }),
  z.object({ t: z.literal("panggil"), idSesi: IdSesi, alasan: z.enum(ALASAN_PETUGAS), prioritas: z.enum(["biasa", "segera"]) }),
  z.object({ t: z.literal("draf"), idSesi: IdSesi, kolomRagu: z.array(KolomRaguSchema) }),
]);
export type KePetugas = z.infer<typeof KePetugasSchema>;

export const KEPUTUSAN = ["setuju", "ambil_alih", "datang", "selesai"] as const;
/** Yang dikirim tombol dashboard; nama petugas diisi server dari sesi login, bukan dari klien. */
export const AksiPetugasSchema = z.object({ t: z.enum(KEPUTUSAN), idSesi: IdSesi });
export const DariPetugasSchema = AksiPetugasSchema.extend({ petugas: z.string().trim().min(1).max(40) });
export type DariPetugas = z.infer<typeof DariPetugasSchema>;

export { samarkanNomor };

function nilai(kolom: string, d: DrafPendaftaran): Omit<KolomRagu, "kolom"> {
  const id = d.identitas;
  const dok = d.dokumen;
  switch (kolom) {
    case "nama":
      return { kartu: id?.nama ?? null, dokumen: dok?.nama.nilai ?? null };
    case "nik":
      return { kartu: samarkanNomor(id?.nik), dokumen: samarkanNomor(dok?.nik?.nilai) };
    case "nomorKartu":
      return { kartu: samarkanNomor(id?.nomorKartu), dokumen: samarkanNomor(dok?.nomorKartu?.nilai) };
    case "tanggalLahir":
      return { kartu: id?.tanggalLahir ?? null, dokumen: dok?.tanggalLahir?.nilai ?? null };
    case "berlakuSampai":
      return { kartu: null, dokumen: dok?.berlakuSampai.nilai ?? null };
    case "poliTujuan":
      return { kartu: d.booking?.poli ?? null, dokumen: dok?.poliTujuan.nilai ?? null };
    case "jenis_dokumen":
      return { kartu: d.kunjungan, dokumen: dok?.jenis ?? null };
    default:
      return { kartu: null, dokumen: null };
  }
}

const namaKolom = (b: BenderaData) => (b.kolom === "ocr_ragu" ? b.kolomRagu : b.kolom === "rujukan_kedaluwarsa" ? "berlakuSampai" : b.kolom);

/** Satu-satunya jalan draf ke dashboard: hanya kolom ragu beserta nilainya. */
export function ringkasDraf(d: DrafPendaftaran): KolomRagu[] {
  return [...new Set(d.bendera.map(namaKolom))].map((kolom) => ({ kolom, ...nilai(kolom, d) }));
}

export function pesanDariEfek(idSesi: string, e: Efek): KePetugas | null {
  if (e.efek === "panggil_petugas") return { t: "panggil", idSesi, alasan: e.alasan, prioritas: e.prioritas };
  if (e.efek === "kirim_draf_ke_petugas") return { t: "draf", idSesi, kolomRagu: ringkasDraf(e.draf) };
  return null;
}

export const pesanSesi = (idSesi: string, mulai: number, s: Keadaan): KePetugas => ({
  t: "sesi",
  idSesi,
  tag: s.tag,
  mulai,
  petugasDatang: s.tag === "MEMANGGIL_PETUGAS" && s.datang,
});
