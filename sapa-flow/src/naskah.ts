/**
 * Naskah Sapa: apa yang diucapkan (TTS), apa yang tampil (subtitle), dan pose avatar.
 *
 * - `NASKAH` bertipe mapped type atas semua Tag → lupa satu keadaan = error kompilasi.
 * - Kalimat ditulis manusia dan ditinjau; tidak ada LLM yang mengarang ucapan ke pasien.
 * - Nama, NIK, nomor kartu, dan poli TIDAK PERNAH diucapkan (dijamin tipe `ucap`),
 *   karena kios memakai speaker di ruang publik. Data itu hanya tampil di layar.
 */
import type { AlasanPetugas } from "./domain.js";
import type { KeadaanDengan, Keadaan, Tag } from "./mesin.js";
import { ucap, type Giliran } from "./ucapan.js";

type Naskah = { readonly [T in Tag]: (s: KeadaanDengan<T>) => Giliran };

const pelan = 0.85 as const;
const sedang = 0.9 as const;

const ALASAN_TERUCAP: { readonly [A in AlasanPetugas]: Giliran["ucapan"] } = {
  izin_ditolak: ucap`Baik, tidak apa-apa. Petugas akan membantu langsung, ya.`,
  diminta_pasien: ucap`Baik. Petugas segera datang membantu.`,
  kartu_tak_terbaca: ucap`Kartunya belum terbaca. Tidak apa-apa, petugas segera datang membantu.`,
  peserta_tidak_aktif: ucap`Ada yang perlu dicek petugas. Mohon tunggu sebentar, ya.`,
  verifikasi_tidak_cocok: ucap`Tidak apa-apa. Petugas segera datang untuk membantu verifikasi.`,
  verifikasi_tak_terbaca: ucap`Wajah dan sidik jarinya belum terbaca. Tidak apa-apa, petugas segera datang.`,
  jawaban_tidak_jelas: ucap`Maaf, saya belum menangkap jawabannya. Petugas segera datang membantu.`,
  diam_terlalu_lama: ucap`Petugas segera datang membantu, ya.`,
  kebutuhan_lain: ucap`Untuk keperluan itu, petugas akan membantu langsung.`,
  dokumen_tak_terbaca: ucap`Suratnya belum terbaca. Tidak apa-apa, petugas segera datang.`,
  data_dikoreksi_pasien: ucap`Terima kasih sudah memeriksa. Petugas akan membetulkan datanya bersama.`,
  layanan_ai_terputus: ucap`Maaf, sistem saya sedang lambat. Petugas segera datang membantu.`,
  kemungkinan_darurat: ucap`Saya panggilkan petugas sekarang juga. Silakan duduk dulu, ya.`,
  non_bpjs: ucap`Untuk pendaftaran tanpa BPJS, petugas akan membantu langsung.`,
  admission: ucap`Untuk rawat inap, petugas akan membantu langsung.`,
  kode_booking_tak_terbaca: ucap`Kode bookingnya belum terbaca. Tidak apa-apa, petugas segera datang membantu.`,
  waktu_habis: ucap`Supaya tidak menunggu lama, petugas segera datang membantu, ya.`,
};

export const NASKAH: Naskah = {
  TANYA_MODE: (s) =>
    s.k.ulang === 0
      ? {
          ucapan: ucap`Selamat datang, ${"Bapak/Ibu"}. Saya Sapa, pemandu pendaftaran. Hari ini pakai BPJS, sudah punya kode booking dari Mobile JKN, atau bukan BPJS?`,
          subtitle: "Pakai BPJS, kode booking Mobile JKN, atau bukan BPJS?",
          ekspresi: "menyapa",
          tempo: pelan,
        }
      : {
          ucapan: ucap`Maaf, boleh diulang? Pakai BPJS, kode booking, atau bukan BPJS?`,
          subtitle: "BPJS, kode booking, atau bukan BPJS?",
          ekspresi: "mendengar",
          tempo: pelan,
        },

  MINTA_KODE_BOOKING: (s) =>
    s.percobaan === 1 && s.k.ulang === 0
      ? {
          ucapan: ucap`Terima kasih. Silakan buka kode booking di aplikasi Mobile JKN, lalu tunjukkan layar HP ke kotak yang menyala.`,
          subtitle: "Tunjukkan kode booking Mobile JKN ke kotak menyala",
          ekspresi: "memandu",
          tempo: sedang,
        }
      : {
          ucapan: ucap`Kodenya belum terbaca. Coba dekatkan layar HP ke kotak, ya.`,
          subtitle: "Dekatkan layar HP ke kotak yang menyala",
          ekspresi: "memandu",
          tempo: pelan,
        },

  SAPA_IZIN: (s) =>
    s.k.ulang === 0
      ? {
          ucapan: ucap`Baik. Data ${s.k.sapaan} akan dipakai untuk pendaftaran hari ini. Boleh saya lanjutkan?`,
          subtitle: "Data dipakai untuk daftar hari ini. Boleh? Ya / tidak",
          ekspresi: "mendengar",
          tempo: pelan,
        }
      : {
          ucapan: ucap`Maaf, saya kurang dengar. Boleh saya lanjutkan? Cukup jawab ya, atau tidak.`,
          subtitle: "Cukup jawab: ya / tidak",
          ekspresi: "mendengar",
          tempo: pelan,
        },

  MINTA_KARTU: (s) =>
    s.percobaan === 1 && s.k.ulang === 0
      ? {
          ucapan: ucap`Terima kasih. Silakan letakkan kartu BPJS atau KTP di kotak yang menyala.`,
          subtitle: "Letakkan kartu BPJS / KTP di kotak yang menyala",
          ekspresi: "memandu",
          tempo: sedang,
        }
      : {
          ucapan: ucap`Kartunya belum terbaca. Coba letakkan lagi, rata dengan kaca, ya.`,
          subtitle: "Letakkan lagi kartunya, rata dengan kaca",
          ekspresi: "memandu",
          tempo: pelan,
        },

  VERIFIKASI_WAJAH: (s) => {
    const sp = s.k.sapaan;
    switch (s.pandu) {
      case "awal":
        return { ucapan: ucap`Terima kasih, ${sp}. Sekarang lihat ke kamera di atas layar, ya.`, subtitle: "Lihat ke kamera di atas layar", ekspresi: "memandu", tempo: sedang };
      case "maju":
        return { ucapan: ucap`Sedikit maju, ${sp}. Ya, begitu. Tahan sebentar.`, subtitle: "Sedikit maju… tahan sebentar", ekspresi: "memandu", tempo: pelan };
      case "terang":
        return { ucapan: ucap`Saya terangkan lampunya. Lihat ke kamera sekali lagi, ya.`, subtitle: "Lampu diterangkan. Lihat ke kamera lagi", ekspresi: "memandu", tempo: pelan };
      case "lepas_penutup":
        return { ucapan: ucap`Boleh masker atau topinya dilepas sebentar, ${sp}?`, subtitle: "Boleh lepas masker / topi sebentar?", ekspresi: "memandu", tempo: pelan };
      case "ulang":
        return { ucapan: ucap`Kita coba sekali lagi. Lihat lurus ke kamera, ya.`, subtitle: "Coba lagi: lihat lurus ke kamera", ekspresi: "memandu", tempo: pelan };
    }
  },

  VERIFIKASI_SIDIK_JARI: (s) =>
    s.percobaan === 1 && s.k.ulang === 0
      ? {
          ucapan: ucap`Tidak apa-apa, ${s.k.sapaan}. Kita pakai sidik jari saja, ya. Letakkan jari telunjuk di alat sidik jari.`,
          subtitle: "Letakkan jari telunjuk di alat sidik jari",
          ekspresi: "memandu",
          tempo: pelan,
        }
      : {
          ucapan: ucap`Sidik jarinya belum terbaca. Coba letakkan lagi, tekan pelan, ya.`,
          subtitle: "Letakkan lagi jarinya, tekan pelan",
          ekspresi: "memandu",
          tempo: pelan,
        },

  TANYA_KUNJUNGAN: (s) =>
    s.k.ulang === 0
      ? {
          ucapan:
            s.k.verifikasi === "sidik_jari"
              ? ucap`Sidik jari sudah cocok, terima kasih. Hari ini ${s.k.sapaan} mau kontrol, atau membawa rujukan baru?`
              : ucap`Wajah sudah cocok, terima kasih. Hari ini ${s.k.sapaan} mau kontrol, atau membawa rujukan baru?`,
          subtitle: "Kontrol, atau bawa rujukan baru?",
          ekspresi: "mendengar",
          tempo: sedang,
        }
      : {
          ucapan: ucap`Maaf, boleh diulang? Kontrol, atau rujukan baru?`,
          subtitle: "Kontrol, atau rujukan baru?",
          ekspresi: "mendengar",
          tempo: pelan,
        },

  SCAN_DOKUMEN: (s) => {
    const rujukan = s.k.kunjungan === "rujukan_baru";
    if (s.percobaan > 1 || s.k.ulang > 0) {
      return { ucapan: ucap`Suratnya belum terbaca. Coba letakkan lagi, tulisannya menghadap ke bawah, ya.`, subtitle: "Letakkan lagi suratnya, tulisan menghadap kaca", ekspresi: "memandu", tempo: pelan };
    }
    return rujukan
      ? { ucapan: ucap`Silakan letakkan surat rujukan dari puskesmas atau klinik di kotak yang menyala.`, subtitle: "Letakkan surat rujukan di kotak yang menyala", ekspresi: "memandu", tempo: sedang }
      : { ucapan: ucap`Silakan letakkan surat kontrol di kotak yang menyala.`, subtitle: "Letakkan surat kontrol di kotak yang menyala", ekspresi: "memandu", tempo: sedang };
  },

  KONFIRMASI_DATA: (s) =>
    s.k.ulang === 0
      ? {
          ucapan: ucap`Data kunjungan ${s.k.sapaan} ada di layar. Sudah betul?`,
          subtitle: "Data di layar sudah betul? Jawab: ya / tidak",
          ekspresi: "mendengar",
          tempo: sedang,
        }
      : {
          ucapan: ucap`Maaf, saya kurang dengar. Data di layar sudah betul? Cukup jawab ya, atau tidak.`,
          subtitle: "Data di layar sudah betul? Ya / tidak",
          ekspresi: "mendengar",
          tempo: pelan,
        },

  MENUNGGU_PETUGAS_CEK: () => ({
    ucapan: ucap`Terima kasih. Petugas sedang memeriksa sebentar, ya.`,
    subtitle: "Petugas sedang memeriksa sebentar…",
    ekspresi: "senang",
    tempo: sedang,
  }),

  MEMANGGIL_PETUGAS: (s) =>
    s.datang
      ? { ucapan: ucap`Petugas sudah di sini, ${s.k.sapaan}. Silakan dibantu langsung.`, subtitle: "Petugas sudah di sini", ekspresi: "senang", tempo: sedang }
      : {
    ucapan: ALASAN_TERUCAP[s.alasan],
    subtitle: s.alasan === "kemungkinan_darurat" ? "Petugas dipanggil SEKARANG. Silakan duduk dulu" : "Petugas segera datang membantu",
    ekspresi: "petugas",
    tempo: pelan,
  },

  // Nomor antrean dan poli hanya tampil di layar; arahan mengikuti status RM dari SIMRS.
  SELESAI: (s) =>
    s.hasil === "dilayani_petugas"
      ? { ucapan: ucap`Terima kasih, ${s.k.sapaan}. Semoga lekas sehat.`, subtitle: "Terima kasih. Semoga lekas sehat!", ekspresi: "senang", tempo: sedang }
      : s.k.rm === "ada"
        ? { ucapan: ucap`Ini nomor antrean ${s.k.sapaan}. Silakan menuju poli, petunjuknya ada di layar. Semoga lekas sehat.`, subtitle: "Nomor antrean di layar. Silakan ke poli. Lekas sehat!", ekspresi: "senang", tempo: sedang }
        : { ucapan: ucap`Ini nomor antrean ${s.k.sapaan}. Silakan ke bagian admisi dulu, petunjuknya ada di layar. Semoga lekas sehat.`, subtitle: "Nomor antrean di layar. Silakan ke admisi dulu.", ekspresi: "senang", tempo: sedang },
};

export function giliranUntuk(s: Keadaan): Giliran {
  // Satu-satunya cast: TS tidak bisa mengaitkan s.tag dengan parameter fungsi di mapped type.
  return (NASKAH[s.tag] as (x: Keadaan) => Giliran)(s);
}
