/**
 * State machine alur Sapa. Fungsi murni: (keadaan, peristiwa) → (keadaan berikut, efek).
 *
 * Jaminan yang dipegang oleh TIPE (bukan dokumen):
 *  1. Tidak ada keadaan "DITOLAK". Satu-satunya akhir adalah SELESAI dengan hasil
 *     `antrean_dicetak` atau `dilayani_petugas`  → kios tidak pernah menolak pasien.
 *  2. Setiap keadaan wajib punya naskah (lihat `NASKAH` di naskah.ts, mapped type).
 *  3. `switch` atas keadaan & peristiwa dicek tuntas (`tuntas(x: never)`).
 *  4. Kios tidak menulis ke SIMRS/BPJS: efek paling jauh adalah `kirim_draf_ke_petugas`.
 */
import { samarkanNomor, type AlasanPetugas, type BenderaData, type Booking, type DokumenOcr, type HasilFrista, type HasilSidikJari, type IdentitasKartu, type Sapaan, type StatusRm } from "./domain.js";
import type { Pemahaman } from "./pemahaman.js";
import type { Giliran } from "./ucapan.js";
import type { Topik } from "./pertanyaan.js";
import { cocokkan } from "./cocokkan.js";
import { giliranUntuk } from "./naskah.js";

// ---------------------------------------------------------------- konteks sesi
export interface Konteks {
  readonly hariIni: string; // YYYY-MM-DD, disuntik saat sesi dibuat (fungsi tetap murni)
  readonly sapaan: Sapaan;
  /** Mode konsol yang dilayani Sapa. Non BPJS dan Admission langsung ke petugas, jadi tidak pernah tersimpan. */
  readonly mode: "bpjs" | "checkin" | null;
  readonly izin: boolean;
  readonly identitas: IdentitasKartu | null;
  readonly booking: Booking | null;
  readonly rm: StatusRm | null;
  /** Cara identitas terverifikasi. Tidak ada jalur ke data kunjungan tanpa ini (diuji properti). */
  readonly verifikasi: "wajah" | "sidik_jari" | null;
  readonly kunjungan: "kontrol" | "rujukan_baru" | null;
  readonly dokumen: DokumenOcr | null;
  readonly bendera: readonly BenderaData[];
  /** Berapa kali pertanyaan saat ini harus diulang (tidak jelas / diam). */
  readonly ulang: number;
}

export const BATAS = {
  tanyaUlang: 2, // jawaban tidak jelas/diam ke-2 → petugas
  kartu: 2,
  kodeBooking: 2,
  wajahTakTerdeteksi: 3,
  wajahTidakCocok: 2,
  sidikJari: 2,
  dokumen: 2,
} as const;

export type Pandu = "awal" | "maju" | "terang" | "lepas_penutup" | "ulang";

// ---------------------------------------------------------------- keadaan
export type Keadaan =
  | { readonly tag: "TANYA_MODE"; readonly k: Konteks }
  | { readonly tag: "SAPA_IZIN"; readonly k: Konteks }
  | { readonly tag: "MINTA_KARTU"; readonly k: Konteks; readonly percobaan: number }
  | { readonly tag: "MINTA_KODE_BOOKING"; readonly k: Konteks; readonly percobaan: number }
  | { readonly tag: "VERIFIKASI_WAJAH"; readonly k: Konteks; readonly percobaan: number; readonly tidakCocok: number; readonly pandu: Pandu }
  | { readonly tag: "VERIFIKASI_SIDIK_JARI"; readonly k: Konteks; readonly percobaan: number; readonly adaTidakCocok: boolean }
  | { readonly tag: "TANYA_KUNJUNGAN"; readonly k: Konteks }
  | { readonly tag: "SCAN_DOKUMEN"; readonly k: Konteks; readonly percobaan: number }
  | { readonly tag: "KONFIRMASI_DATA"; readonly k: Konteks }
  | { readonly tag: "MENUNGGU_PETUGAS_CEK"; readonly k: Konteks }
  /** Kios terkunci di sini sampai PETUGAS_SELESAI; PETUGAS_DATANG hanya mengganti subtitle (`datang`). */
  | { readonly tag: "MEMANGGIL_PETUGAS"; readonly k: Konteks; readonly alasan: AlasanPetugas; readonly datang: boolean }
  /** Nomor antrean dibuat sistem petugas (kios dilarang "antrean add"), lalu dibawa PETUGAS_SETUJU. */
  | { readonly tag: "SELESAI"; readonly k: Konteks; readonly hasil: "antrean_dicetak"; readonly nomorAntrean: string }
  | { readonly tag: "SELESAI"; readonly k: Konteks; readonly hasil: "dilayani_petugas" };

/** Perhatikan: tidak ada "ditolak". Diuji juga di tes tipe. */
export type HasilAkhir = "antrean_dicetak" | "dilayani_petugas";
export type Tag = Keadaan["tag"];
export type KeadaanDengan<T extends Tag> = Extract<Keadaan, { tag: T }>;

/** Keadaan yang sedang menunggu jawaban lisan, dan topik pertanyaannya. */
export const TOPIK_KEADAAN = {
  TANYA_MODE: "mode",
  SAPA_IZIN: "izin",
  TANYA_KUNJUNGAN: "kunjungan",
  KONFIRMASI_DATA: "konfirmasi",
} as const satisfies Partial<Record<Tag, Topik>>;

// ---------------------------------------------------------------- peristiwa
type Jawaban = { [T in Topik]: { readonly tipe: "JAWABAN"; readonly topik: T; readonly hasil: Pemahaman<T> } }[Topik];

export type Peristiwa =
  | Jawaban
  /** `rm` diisi runner dari SIMRS (baca saja). */
  | { readonly tipe: "KARTU_TERBACA"; readonly identitas: IdentitasKartu; readonly rm: StatusRm }
  | { readonly tipe: "KARTU_GAGAL" }
  /** Runner: kode dipindai dari layar HP, lalu Antrean + VClaim + SIMRS dibaca. */
  | { readonly tipe: "KODE_BOOKING_TERBACA"; readonly identitas: IdentitasKartu; readonly booking: Booking; readonly rm: StatusRm }
  | { readonly tipe: "KODE_BOOKING_GAGAL" }
  | { readonly tipe: "FRISTA"; readonly hasil: HasilFrista }
  | { readonly tipe: "SIDIK_JARI"; readonly hasil: HasilSidikJari }
  | { readonly tipe: "DOKUMEN_TERBACA"; readonly dokumen: DokumenOcr }
  | { readonly tipe: "DOKUMEN_GAGAL" }
  | { readonly tipe: "TOMBOL_ULANGI" }
  | { readonly tipe: "TOMBOL_PETUGAS" }
  | { readonly tipe: "DIAM" }
  | { readonly tipe: "PETUGAS_DATANG" }
  | { readonly tipe: "PETUGAS_SELESAI" }
  | { readonly tipe: "PETUGAS_SETUJU"; readonly nomorAntrean: string }
  | { readonly tipe: "PETUGAS_AMBIL_ALIH" }
  /** Dikirim runner saat batas sesi lewat; mesin sendiri tidak punya jam. */
  | { readonly tipe: "WAKTU_HABIS" };

// ---------------------------------------------------------------- efek
/** Data yang tampil di layar (boleh pribadi) — tidak pernah lewat speaker. */
export interface KartuLayar {
  readonly judul: string;
  readonly baris: readonly { readonly label: string; readonly nilai: string; readonly ragu: boolean }[];
}

export interface DrafPendaftaran {
  readonly mode: Konteks["mode"];
  readonly identitas: IdentitasKartu | null;
  readonly verifikasi: Konteks["verifikasi"];
  readonly kunjungan: Konteks["kunjungan"];
  readonly dokumen: DokumenOcr | null;
  readonly booking: Booking | null;
  readonly rm: StatusRm | null;
  readonly bendera: readonly BenderaData[];
  readonly sumberKolom: Readonly<Record<string, "kartu" | "ocr" | "jawaban_lisan" | "booking" | "simrs">>;
}

export type Arahan = "poli" | "admisi";

export type CatatanAudit =
  | { readonly jenis: "izin"; readonly diberikan: boolean }
  | { readonly jenis: "frista"; readonly hasil: HasilFrista["hasil"]; readonly percobaan: number }
  | { readonly jenis: "sidik_jari"; readonly hasil: HasilSidikJari["hasil"]; readonly percobaan: number }
  /** Dibuat runner sesi saat masuk SELESAI. */
  | { readonly jenis: "durasi_sesi"; readonly ms: number }
  | { readonly jenis: "pemahaman"; readonly topik: Topik; readonly hasil: Pemahaman<Topik>["jenis"]; readonly sumber?: string }
  | { readonly jenis: "bendera"; readonly bendera: readonly BenderaData[] }
  | { readonly jenis: "eskalasi"; readonly alasan: AlasanPetugas; readonly dari: Tag }
  | { readonly jenis: "keputusan_petugas"; readonly keputusan: "setuju" | "ambil_alih" | "datang" | "selesai" }
  | { readonly jenis: "diabaikan"; readonly peristiwa: Peristiwa["tipe"]; readonly di: Tag };

export type Efek =
  | { readonly efek: "bicara"; readonly giliran: Giliran }
  | { readonly efek: "tampilkan_kartu"; readonly isi: KartuLayar }
  | { readonly efek: "lampu"; readonly target: "pemindai" | "wajah"; readonly nyala: boolean }
  | { readonly efek: "kamera"; readonly aksi: "bingkai_otomatis" | "naikkan_eksposur" }
  | { readonly efek: "panggil_petugas"; readonly alasan: AlasanPetugas; readonly prioritas: "biasa" | "segera" }
  | { readonly efek: "kirim_draf_ke_petugas"; readonly draf: DrafPendaftaran }
  | { readonly efek: "cetak_antrean"; readonly nomorAntrean: string; readonly arahan: Arahan }
  | { readonly efek: "audit"; readonly catatan: CatatanAudit };

export interface Langkah {
  readonly berikut: Keadaan;
  readonly efek: readonly Efek[];
}

// ---------------------------------------------------------------- utilitas
export function tuntas(x: never): never {
  throw new Error(`Kasus tidak tertangani: ${JSON.stringify(x)}`);
}

export function mulai(hariIni: string): Langkah {
  const k: Konteks = {
    hariIni,
    sapaan: "Bapak/Ibu",
    mode: null,
    izin: false,
    identitas: null,
    booking: null,
    rm: null,
    verifikasi: null,
    kunjungan: null,
    dokumen: null,
    bendera: [],
    ulang: 0,
  };
  return masuk({ tag: "TANYA_MODE", k });
}

/** Efek saat MEMASUKI sebuah keadaan: naskah + perangkat. */
export function masuk(s: Keadaan, sebelum: readonly Efek[] = []): Langkah {
  const efek: Efek[] = [...sebelum];
  switch (s.tag) {
    case "TANYA_MODE":
    case "SAPA_IZIN":
    case "TANYA_KUNJUNGAN":
    case "MENUNGGU_PETUGAS_CEK":
      break;
    case "MINTA_KARTU":
    case "MINTA_KODE_BOOKING":
    case "SCAN_DOKUMEN":
      efek.push({ efek: "lampu", target: "pemindai", nyala: true });
      break;
    case "VERIFIKASI_WAJAH":
      efek.push({ efek: "lampu", target: "pemindai", nyala: false });
      efek.push({ efek: "lampu", target: "wajah", nyala: true });
      efek.push({ efek: "kamera", aksi: s.pandu === "terang" ? "naikkan_eksposur" : "bingkai_otomatis" });
      break;
    case "VERIFIKASI_SIDIK_JARI":
      efek.push({ efek: "lampu", target: "wajah", nyala: false });
      break;
    case "KONFIRMASI_DATA":
      efek.push({ efek: "lampu", target: "pemindai", nyala: false });
      efek.push({ efek: "tampilkan_kartu", isi: kartuKonfirmasi(s.k) });
      break;
    case "MEMANGGIL_PETUGAS":
      if (s.datang) break; // petugas sudah di kios: hanya naskah yang berganti, tidak memanggil ulang
      efek.push({ efek: "panggil_petugas", alasan: s.alasan, prioritas: s.alasan === "kemungkinan_darurat" ? "segera" : "biasa" });
      efek.push({ efek: "kirim_draf_ke_petugas", draf: draf(s.k) });
      break;
    case "SELESAI":
      if (s.hasil === "antrean_dicetak") {
        efek.push({ efek: "cetak_antrean", nomorAntrean: s.nomorAntrean, arahan: s.k.rm === "ada" ? "poli" : "admisi" });
      }
      break;
    default:
      return tuntas(s);
  }
  efek.push({ efek: "bicara", giliran: giliranUntuk(s) });
  return { berikut: s, efek };
}

function keKonteks(k: Konteks, ubah: Partial<Konteks>): Konteks {
  return { ...k, ...ubah };
}

function panggilPetugas(dari: Keadaan, alasan: AlasanPetugas, sebelum: readonly Efek[] = []): Langkah {
  return masuk({ tag: "MEMANGGIL_PETUGAS", k: keKonteks(dari.k, { ulang: 0 }), alasan, datang: false }, [
    ...sebelum,
    { efek: "audit", catatan: { jenis: "eskalasi", alasan, dari: dari.tag } },
  ]);
}

/** Jawaban tidak jelas / diam: ulangi pertanyaan, atau panggil petugas setelah batas. */
function ulangiAtauPetugas(s: Keadaan, alasan: AlasanPetugas, sebelum: readonly Efek[] = []): Langkah {
  const ulang = s.k.ulang + 1;
  if (ulang >= BATAS.tanyaUlang) return panggilPetugas(s, alasan, sebelum);
  return masuk({ ...s, k: keKonteks(s.k, { ulang }) } as Keadaan, sebelum);
}

function diabaikan(s: Keadaan, p: Peristiwa): Langkah {
  return { berikut: s, efek: [{ efek: "audit", catatan: { jenis: "diabaikan", peristiwa: p.tipe, di: s.tag } }] };
}

function draf(k: Konteks): DrafPendaftaran {
  const asal = k.booking ? "booking" : "kartu";
  return {
    mode: k.mode,
    identitas: k.identitas,
    verifikasi: k.verifikasi,
    kunjungan: k.kunjungan,
    dokumen: k.dokumen,
    booking: k.booking,
    rm: k.rm,
    bendera: k.bendera,
    sumberKolom: {
      ...(k.identitas ? { nama: asal, nik: asal, tanggalLahir: asal } : {}),
      ...(k.kunjungan ? { kunjungan: "jawaban_lisan" } : {}),
      ...(k.dokumen ? { poliTujuan: "ocr", berlakuSampai: "ocr" } : {}),
      ...(k.booking ? { poliTujuan: "booking", jamPraktik: "booking" } : {}),
      ...(k.rm ? { rm: "simrs" } : {}),
    },
  };
}

/** Kartu atau kode booking terbaca: identitas yang diklaim, lalu wajib diverifikasi. */
function keVerifikasiWajah(s: Keadaan, identitas: IdentitasKartu, ubah: Partial<Konteks>): Langkah {
  if (identitas.statusPeserta === "tidak_aktif") return panggilPetugas(s, "peserta_tidak_aktif");
  const sapaan = identitas.jenisKelamin === "L" ? "Bapak" : "Ibu";
  return masuk({
    tag: "VERIFIKASI_WAJAH",
    k: keKonteks(s.k, { ...ubah, identitas, sapaan, ulang: 0 }),
    percobaan: 1,
    tidakCocok: 0,
    pandu: "awal",
  });
}

/** Satu-satunya pintu ke data kunjungan: hanya dipanggil setelah wajah ATAU sidik jari cocok. */
function setelahVerifikasi(k: Konteks): Keadaan {
  return k.mode === "checkin" ? { tag: "KONFIRMASI_DATA", k } : { tag: "TANYA_KUNJUNGAN", k };
}

function kartuKonfirmasi(k: Konteks): KartuLayar {
  if (k.booking) {
    return {
      judul: "Data kunjungan hari ini",
      baris: [
        { label: "Nama", nilai: k.identitas?.nama ?? "-", ragu: false },
        { label: "NIK", nilai: samarkanNomor(k.identitas?.nik) ?? "-", ragu: false },
        { label: "Tanggal lahir", nilai: k.identitas?.tanggalLahir ?? "-", ragu: false },
        { label: "Kunjungan", nilai: "Check-in Mobile JKN", ragu: false },
        { label: "Poli tujuan", nilai: k.booking.poli.replace(/_/g, " "), ragu: false },
        { label: "Jam praktik", nilai: k.booking.jamPraktik, ragu: false },
      ],
    };
  }
  const ragu = (kolom: string) => k.bendera.some((b) => b.kolom === kolom || (b.kolom === "ocr_ragu" && b.kolomRagu === kolom));
  const poli = k.dokumen?.poliTujuan.nilai ?? "-";
  return {
    judul: "Data kunjungan hari ini",
    baris: [
      { label: "Nama", nilai: k.identitas?.nama ?? "-", ragu: ragu("nama") },
      { label: "NIK", nilai: samarkanNomor(k.identitas?.nik) ?? "-", ragu: ragu("nik") },
      { label: "Tanggal lahir", nilai: k.identitas?.tanggalLahir ?? "-", ragu: ragu("tanggalLahir") },
      { label: "Kunjungan", nilai: k.kunjungan === "kontrol" ? "Kontrol" : "Rujukan baru", ragu: false },
      { label: "Poli tujuan", nilai: poli.replace(/_/g, " "), ragu: ragu("poliTujuan") },
      { label: "Rujukan berlaku s.d.", nilai: k.dokumen?.berlakuSampai.nilai ?? "-", ragu: ragu("rujukan_kedaluwarsa") || ragu("berlakuSampai") },
    ],
  };
}

const auditPemahaman = (topik: Topik, h: Pemahaman<Topik>): Efek => ({
  efek: "audit",
  catatan: { jenis: "pemahaman", topik, hasil: h.jenis, ...(h.jenis === "pasti" ? { sumber: h.sumber } : {}) },
});

// ---------------------------------------------------------------- transisi
export function langkah(s: Keadaan, p: Peristiwa): Langkah {
  // Akhir bersifat menyerap.
  if (s.tag === "SELESAI") return diabaikan(s, p);

  // Peristiwa global
  switch (p.tipe) {
    case "TOMBOL_ULANGI":
      return { berikut: s, efek: [{ efek: "bicara", giliran: giliranUntuk(s) }] };
    case "TOMBOL_PETUGAS":
      if (s.tag === "MEMANGGIL_PETUGAS" || s.tag === "MENUNGGU_PETUGAS_CEK") return diabaikan(s, p);
      return panggilPetugas(s, "diminta_pasien");
    case "DIAM":
      if (s.tag === "MEMANGGIL_PETUGAS" || s.tag === "MENUNGGU_PETUGAS_CEK") return diabaikan(s, p);
      return ulangiAtauPetugas(s, "diam_terlalu_lama");
    case "WAKTU_HABIS":
      if (s.tag === "MEMANGGIL_PETUGAS" || s.tag === "MENUNGGU_PETUGAS_CEK") return diabaikan(s, p);
      return panggilPetugas(s, "waktu_habis");
    case "JAWABAN":
      // Darurat menang atas segalanya, termasuk saat sudah menunggu petugas (naikkan prioritas).
      if (p.hasil.jenis === "darurat") {
        if (s.tag === "MEMANGGIL_PETUGAS" && s.alasan === "kemungkinan_darurat") return diabaikan(s, p);
        return panggilPetugas(s, "kemungkinan_darurat", [auditPemahaman(p.topik, p.hasil)]);
      }
      if (p.hasil.jenis === "minta_petugas" && s.tag !== "MEMANGGIL_PETUGAS" && s.tag !== "MENUNGGU_PETUGAS_CEK") {
        return panggilPetugas(s, "diminta_pasien", [auditPemahaman(p.topik, p.hasil)]);
      }
      break;
    case "KARTU_TERBACA":
    case "KARTU_GAGAL":
    case "KODE_BOOKING_TERBACA":
    case "KODE_BOOKING_GAGAL":
    case "FRISTA":
    case "SIDIK_JARI":
    case "DOKUMEN_TERBACA":
    case "DOKUMEN_GAGAL":
    case "PETUGAS_DATANG":
    case "PETUGAS_SELESAI":
    case "PETUGAS_SETUJU":
    case "PETUGAS_AMBIL_ALIH":
      break;
    default:
      return tuntas(p);
  }

  switch (s.tag) {
    case "TANYA_MODE": {
      if (p.tipe !== "JAWABAN" || p.topik !== "mode") return diabaikan(s, p);
      const a = auditPemahaman("mode", p.hasil);
      switch (p.hasil.jenis) {
        case "pasti":
          switch (p.hasil.opsi) {
            case "bpjs":
            case "checkin":
              return masuk({ tag: "SAPA_IZIN", k: keKonteks(s.k, { mode: p.hasil.opsi, ulang: 0 }) }, [a]);
            case "non_bpjs":
            case "admission":
              return panggilPetugas(s, p.hasil.opsi, [a]);
            default:
              return tuntas(p.hasil.opsi);
          }
        case "tanya_ulang":
          return ulangiAtauPetugas(s, p.hasil.sebab === "layanan_terputus" ? "layanan_ai_terputus" : "jawaban_tidak_jelas", [a]);
        case "minta_petugas":
          return panggilPetugas(s, "diminta_pasien", [a]);
        case "darurat":
          return panggilPetugas(s, "kemungkinan_darurat", [a]);
        default:
          return tuntas(p.hasil);
      }
    }

    case "SAPA_IZIN": {
      if (p.tipe !== "JAWABAN" || p.topik !== "izin") return diabaikan(s, p);
      const a = auditPemahaman("izin", p.hasil);
      switch (p.hasil.jenis) {
        case "pasti":
          if (p.hasil.opsi === "ya") {
            const k = keKonteks(s.k, { izin: true, ulang: 0 });
            const sebelum: Efek[] = [a, { efek: "audit", catatan: { jenis: "izin", diberikan: true } }];
            return k.mode === "checkin"
              ? masuk({ tag: "MINTA_KODE_BOOKING", k, percobaan: 1 }, sebelum)
              : masuk({ tag: "MINTA_KARTU", k, percobaan: 1 }, sebelum);
          }
          return panggilPetugas(s, "izin_ditolak", [a, { efek: "audit", catatan: { jenis: "izin", diberikan: false } }]);
        case "tanya_ulang":
          return ulangiAtauPetugas(s, p.hasil.sebab === "layanan_terputus" ? "layanan_ai_terputus" : "jawaban_tidak_jelas", [a]);
        case "minta_petugas":
          return panggilPetugas(s, "diminta_pasien", [a]);
        case "darurat":
          return panggilPetugas(s, "kemungkinan_darurat", [a]);
        default:
          return tuntas(p.hasil);
      }
    }

    case "MINTA_KARTU": {
      if (p.tipe === "KARTU_TERBACA") return keVerifikasiWajah(s, p.identitas, { rm: p.rm });
      if (p.tipe === "KARTU_GAGAL") {
        if (s.percobaan >= BATAS.kartu) return panggilPetugas(s, "kartu_tak_terbaca");
        return masuk({ ...s, percobaan: s.percobaan + 1 });
      }
      return diabaikan(s, p);
    }

    case "MINTA_KODE_BOOKING": {
      if (p.tipe === "KODE_BOOKING_TERBACA") return keVerifikasiWajah(s, p.identitas, { booking: p.booking, rm: p.rm });
      if (p.tipe === "KODE_BOOKING_GAGAL") {
        if (s.percobaan >= BATAS.kodeBooking) return panggilPetugas(s, "kode_booking_tak_terbaca");
        return masuk({ ...s, percobaan: s.percobaan + 1 });
      }
      return diabaikan(s, p);
    }

    case "VERIFIKASI_WAJAH": {
      if (p.tipe !== "FRISTA") return diabaikan(s, p);
      const a: Efek = { efek: "audit", catatan: { jenis: "frista", hasil: p.hasil.hasil, percobaan: s.percobaan } };
      // Wajah gagal → sidik jari (opsi setara), bukan langsung petugas.
      const keSidikJari = (adaTidakCocok: boolean) =>
        masuk({ tag: "VERIFIKASI_SIDIK_JARI", k: keKonteks(s.k, { ulang: 0 }), percobaan: 1, adaTidakCocok }, [a]);
      switch (p.hasil.hasil) {
        case "cocok":
          return masuk(setelahVerifikasi(keKonteks(s.k, { verifikasi: "wajah", ulang: 0 })), [a, { efek: "lampu", target: "wajah", nyala: false }]);
        case "wajah_tidak_terdeteksi": {
          if (s.percobaan >= BATAS.wajahTakTerdeteksi) return keSidikJari(s.tidakCocok > 0);
          const pandu: Pandu =
            p.hasil.sebab === "terlalu_jauh" ? "maju" : p.hasil.sebab === "gelap" ? "terang" : p.hasil.sebab === "tertutup" ? "lepas_penutup" : "ulang";
          return masuk({ ...s, percobaan: s.percobaan + 1, pandu }, [a]);
        }
        case "tidak_cocok": {
          const tidakCocok = s.tidakCocok + 1;
          if (tidakCocok >= BATAS.wajahTidakCocok) return keSidikJari(true);
          return masuk({ ...s, percobaan: s.percobaan + 1, tidakCocok, pandu: "ulang" }, [a]);
        }
        default:
          return tuntas(p.hasil);
      }
    }

    case "VERIFIKASI_SIDIK_JARI": {
      if (p.tipe !== "SIDIK_JARI") return diabaikan(s, p);
      const a: Efek = { efek: "audit", catatan: { jenis: "sidik_jari", hasil: p.hasil.hasil, percobaan: s.percobaan } };
      switch (p.hasil.hasil) {
        case "cocok":
          return masuk(setelahVerifikasi(keKonteks(s.k, { verifikasi: "sidik_jari", ulang: 0 })), [a]);
        case "tidak_cocok":
        case "tidak_terbaca": {
          const adaTidakCocok = s.adaTidakCocok || p.hasil.hasil === "tidak_cocok";
          if (s.percobaan >= BATAS.sidikJari) {
            return panggilPetugas(s, adaTidakCocok ? "verifikasi_tidak_cocok" : "verifikasi_tak_terbaca", [a]);
          }
          return masuk({ ...s, percobaan: s.percobaan + 1, adaTidakCocok }, [a]);
        }
        default:
          return tuntas(p.hasil);
      }
    }

    case "TANYA_KUNJUNGAN": {
      if (p.tipe !== "JAWABAN" || p.topik !== "kunjungan") return diabaikan(s, p);
      const a = auditPemahaman("kunjungan", p.hasil);
      switch (p.hasil.jenis) {
        case "pasti":
          if (p.hasil.opsi === "lainnya") return panggilPetugas(s, "kebutuhan_lain", [a]);
          return masuk({ tag: "SCAN_DOKUMEN", k: keKonteks(s.k, { kunjungan: p.hasil.opsi, ulang: 0 }), percobaan: 1 }, [a]);
        case "tanya_ulang":
          return ulangiAtauPetugas(s, p.hasil.sebab === "layanan_terputus" ? "layanan_ai_terputus" : "jawaban_tidak_jelas", [a]);
        case "minta_petugas":
          return panggilPetugas(s, "diminta_pasien", [a]);
        case "darurat":
          return panggilPetugas(s, "kemungkinan_darurat", [a]);
        default:
          return tuntas(p.hasil);
      }
    }

    case "SCAN_DOKUMEN": {
      if (p.tipe === "DOKUMEN_TERBACA") {
        if (!s.k.identitas) return panggilPetugas(s, "kartu_tak_terbaca"); // tidak mungkin lewat alur normal; aman
        const bendera = cocokkan(s.k.identitas, p.dokumen, s.k.hariIni);
        const jenisSalah = (s.k.kunjungan === "rujukan_baru") !== (p.dokumen.jenis === "rujukan_fktp");
        const semua = jenisSalah ? [...bendera, { kolom: "ocr_ragu", kolomRagu: "jenis_dokumen" } as const] : bendera;
        const efekBendera: Efek[] = semua.length ? [{ efek: "audit", catatan: { jenis: "bendera", bendera: semua } }] : [];
        return masuk({ tag: "KONFIRMASI_DATA", k: keKonteks(s.k, { dokumen: p.dokumen, bendera: semua, ulang: 0 }) }, efekBendera);
      }
      if (p.tipe === "DOKUMEN_GAGAL") {
        if (s.percobaan >= BATAS.dokumen) return panggilPetugas(s, "dokumen_tak_terbaca");
        return masuk({ ...s, percobaan: s.percobaan + 1 });
      }
      return diabaikan(s, p);
    }

    case "KONFIRMASI_DATA": {
      if (p.tipe !== "JAWABAN" || p.topik !== "konfirmasi") return diabaikan(s, p);
      const a = auditPemahaman("konfirmasi", p.hasil);
      switch (p.hasil.jenis) {
        case "pasti":
          if (p.hasil.opsi === "tidak") return panggilPetugas(s, "data_dikoreksi_pasien", [a]);
          return masuk({ tag: "MENUNGGU_PETUGAS_CEK", k: keKonteks(s.k, { ulang: 0 }) }, [
            a,
            { efek: "kirim_draf_ke_petugas", draf: draf(s.k) },
          ]);
        case "tanya_ulang":
          return ulangiAtauPetugas(s, p.hasil.sebab === "layanan_terputus" ? "layanan_ai_terputus" : "jawaban_tidak_jelas", [a]);
        case "minta_petugas":
          return panggilPetugas(s, "diminta_pasien", [a]);
        case "darurat":
          return panggilPetugas(s, "kemungkinan_darurat", [a]);
        default:
          return tuntas(p.hasil);
      }
    }

    case "MENUNGGU_PETUGAS_CEK": {
      if (p.tipe === "PETUGAS_SETUJU") {
        return masuk({ tag: "SELESAI", k: s.k, hasil: "antrean_dicetak", nomorAntrean: p.nomorAntrean }, [{ efek: "audit", catatan: { jenis: "keputusan_petugas", keputusan: "setuju" } }]);
      }
      if (p.tipe === "PETUGAS_AMBIL_ALIH") {
        return masuk({ tag: "SELESAI", k: s.k, hasil: "dilayani_petugas" }, [{ efek: "audit", catatan: { jenis: "keputusan_petugas", keputusan: "ambil_alih" } }]);
      }
      return diabaikan(s, p);
    }

    case "MEMANGGIL_PETUGAS": {
      if (p.tipe === "PETUGAS_DATANG" && !s.datang) {
        return masuk({ ...s, datang: true }, [{ efek: "audit", catatan: { jenis: "keputusan_petugas", keputusan: "datang" } }]);
      }
      if (p.tipe === "PETUGAS_SELESAI") {
        return masuk({ tag: "SELESAI", k: s.k, hasil: "dilayani_petugas" }, [{ efek: "audit", catatan: { jenis: "keputusan_petugas", keputusan: "selesai" } }]);
      }
      return diabaikan(s, p);
    }

    default:
      return tuntas(s);
  }
}
