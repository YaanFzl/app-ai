/**
 * Satu sumber kebenaran untuk pertanyaan tertutup.
 * Jev, Claude, dan pencocok kata kunci membaca definisi yang SAMA,
 * sehingga ketiganya tidak mungkin berbeda daftar opsi.
 */
export const PERTANYAAN = {
  mode: {
    instruksi: "Pasien mendaftar dengan cara apa hari ini?",
    opsi: {
      bpjs: "Berobat memakai BPJS / JKN / KIS",
      checkin: "Sudah punya kode booking atau sudah ambil antrean lewat aplikasi Mobile JKN",
      non_bpjs: "Bukan BPJS: pasien umum, bayar sendiri, atau asuransi lain",
      admission: "Mau rawat inap atau opname",
    },
  },
  izin: {
    instruksi: "Apakah pasien menyetujui datanya diproses untuk pendaftaran berobat hari ini?",
    opsi: {
      ya: "Setuju atau mengiyakan: ya, iya, boleh, silakan, monggo, nggih, muhun",
      tidak: "Menolak atau tidak bersedia: tidak, nggak, jangan, tidak mau",
    },
  },
  kunjungan: {
    instruksi: "Apa tujuan kunjungan pasien ke rumah sakit hari ini?",
    opsi: {
      kontrol: "Kontrol ulang atau berobat lanjutan ke dokter spesialis yang sama, sesuai jadwal kontrol",
      rujukan_baru: "Datang dengan surat rujukan baru dari puskesmas, klinik, atau dokter keluarga",
      lainnya: "Keperluan lain: hanya ambil obat, gawat darurat, menjenguk, atau bertanya",
    },
  },
  konfirmasi: {
    instruksi: "Apakah pasien membenarkan bahwa data kunjungan yang ditampilkan di layar sudah benar?",
    opsi: {
      ya: "Membenarkan: sudah betul, benar, iya cocok",
      tidak: "Menyatakan ada yang salah atau tidak sesuai",
    },
  },
} as const;

export type Topik = keyof typeof PERTANYAAN;
/** Distributif: Opsi<"izin" | "kunjungan"> = gabungan opsi keduanya. */
export type Opsi<T extends Topik> = T extends Topik ? keyof (typeof PERTANYAAN)[T]["opsi"] & string : never;

/** Opsi cadangan yang selalu ditambahkan: jawaban yang tidak bisa dipetakan. */
export const TIDAK_JELAS = "tidak_jelas" as const;
export const DESKRIPSI_TIDAK_JELAS =
  "Jawaban tidak berhubungan dengan pertanyaan, terpotong, ragu-ragu, atau tidak bisa dipahami";

export const INSTRUKSI_DARURAT =
  "Apakah pasien menyebut keluhan yang mungkin gawat darurat sekarang, seperti nyeri dada hebat, sesak napas berat, hampir pingsan, atau lemas mendadak?";

export const INSTRUKSI_MINTA_PETUGAS =
  "Apakah pasien meminta dibantu oleh petugas atau manusia, bukan oleh mesin?";

export function daftarOpsi<T extends Topik>(topik: T): Opsi<T>[] {
  return Object.keys(PERTANYAAN[topik].opsi) as Opsi<T>[];
}
