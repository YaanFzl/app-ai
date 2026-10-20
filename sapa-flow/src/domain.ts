/**
 * Tipe domain APP AI.
 *
 * Prinsip: data pribadi (nama, NIK, nomor kartu, poli) memakai tipe "bermerek"
 * (branded) sehingga TIDAK BISA dimasukkan ke ucapan TTS. Kompiler yang menolak,
 * bukan disiplin manusia. Lihat `ucapan.ts`.
 */
import { z } from "zod";

declare const merek: unique symbol;
/** Tipe bermerek: string biasa tidak bisa dipakai sebagai `Pribadi<"NIK">` tanpa lewat validasi. */
export type Pribadi<K extends string> = string & { readonly [merek]: K };

// ---------- Data pribadi (hanya boleh tampil di layar / dikirim ke sistem resmi) ----------
export const NikSchema = z
  .string()
  .regex(/^\d{16}$/, "NIK harus 16 digit")
  .transform((s) => s as Pribadi<"NIK">);
export const NomorKartuSchema = z
  .string()
  .regex(/^\d{13}$/, "Nomor kartu JKN harus 13 digit")
  .transform((s) => s as Pribadi<"NomorKartu">);
export const NamaSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .transform((s) => s as Pribadi<"Nama">);

export const POLI = ["penyakit_dalam", "jantung", "saraf", "mata", "paru", "bedah", "lainnya"] as const;
export const PoliSchema = z.enum(POLI);
export type Poli = z.infer<typeof PoliSchema>;

/** NIK / nomor kartu untuk layar: `3273010101550001` → `************0001`. Tidak pernah ditampilkan utuh. */
export const samarkanNomor = (s: string | undefined): string | null => (s ? "*".repeat(Math.max(0, s.length - 4)) + s.slice(-4) : null);

/** Sapaan adalah satu-satunya atribut orang yang boleh diucapkan. */
export const SAPAAN = ["Bapak", "Ibu", "Bapak/Ibu"] as const;
export type Sapaan = (typeof SAPAAN)[number];

// ---------- Hasil perangkat & sistem eksternal ----------
export const IdentitasKartuSchema = z.object({
  sumber: z.enum(["kartu_jkn", "ktp"]),
  nik: NikSchema,
  nomorKartu: NomorKartuSchema.optional(),
  nama: NamaSchema,
  tanggalLahir: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jenisKelamin: z.enum(["L", "P"]),
  /** Dari bridging VClaim (baca saja). */
  statusPeserta: z.enum(["aktif", "tidak_aktif"]),
});
export type IdentitasKartu = z.infer<typeof IdentitasKartuSchema>;

/** Hasil FRISTA 1:1 (dipanggil, bukan dibuat ulang oleh APP AI). */
export const HasilFristaSchema = z.discriminatedUnion("hasil", [
  z.object({ hasil: z.literal("cocok") }),
  z.object({ hasil: z.literal("tidak_cocok") }),
  z.object({ hasil: z.literal("wajah_tidak_terdeteksi"), sebab: z.enum(["terlalu_jauh", "gelap", "tertutup", "tidak_diketahui"]) }),
]);
export type HasilFrista = z.infer<typeof HasilFristaSchema>;

/** Hasil alat sidik jari 1:1; opsi setara FRISTA, ditawarkan bila wajah gagal. */
export const HasilSidikJariSchema = z.discriminatedUnion("hasil", [
  z.object({ hasil: z.literal("cocok") }),
  z.object({ hasil: z.literal("tidak_cocok") }),
  z.object({ hasil: z.literal("tidak_terbaca") }),
]);
export type HasilSidikJari = z.infer<typeof HasilSidikJariSchema>;

/** Kode booking Mobile JKN (Antrean, baca saja). Sempit: kolom lain dibuang saat parsing. */
export const BookingSchema = z.object({
  kodeBooking: z.string().min(1),
  nomorAntrean: z.string().min(1),
  poli: PoliSchema,
  tanggalPeriksa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jamPraktik: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/),
});
export type Booking = z.infer<typeof BookingSchema>;

/** Status rekam medis dari SIMRS (baca saja): menentukan arahan akhir poli / admisi. */
export type StatusRm = "ada" | "belum";

/** Satu kolom hasil OCR beserta keyakinannya. */
const Kolom = <T extends z.ZodTypeAny>(t: T) => z.object({ nilai: t, keyakinan: z.number().min(0).max(1) });

export const DokumenOcrSchema = z.object({
  jenis: z.enum(["rujukan_fktp", "surat_kontrol"]),
  nama: Kolom(NamaSchema),
  nik: Kolom(NikSchema).optional(),
  nomorKartu: Kolom(NomorKartuSchema).optional(),
  tanggalLahir: Kolom(z.string()).optional(),
  poliTujuan: Kolom(PoliSchema),
  berlakuSampai: Kolom(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});
export type DokumenOcr = z.infer<typeof DokumenOcrSchema>;

// ---------- Alasan memanggil petugas (daftar tertutup = bisa dianalisis di dashboard) ----------
export const ALASAN_PETUGAS = [
  "izin_ditolak",
  "diminta_pasien",
  "kartu_tak_terbaca",
  "peserta_tidak_aktif",
  /** Wajah dan sidik jari gagal, dan salah satunya "tidak cocok" (sinyal untuk lapisan deteksi). */
  "verifikasi_tidak_cocok",
  /** Wajah dan sidik jari gagal karena tak terbaca (masalah teknis). */
  "verifikasi_tak_terbaca",
  "jawaban_tidak_jelas",
  "diam_terlalu_lama",
  "kebutuhan_lain",
  "dokumen_tak_terbaca",
  "data_dikoreksi_pasien",
  "layanan_ai_terputus",
  "kemungkinan_darurat",
  "non_bpjs",
  "admission",
  "kode_booking_tak_terbaca",
  "waktu_habis",
] as const;
export type AlasanPetugas = (typeof ALASAN_PETUGAS)[number];

/** Bendera beda data untuk lapisan deteksi; bukan tuduhan. */
export type BenderaData =
  | { kolom: "nama"; kemiripan: number }
  | { kolom: "nik" | "nomorKartu" | "tanggalLahir" }
  | { kolom: "rujukan_kedaluwarsa" }
  | { kolom: "ocr_ragu"; kolomRagu: string };
