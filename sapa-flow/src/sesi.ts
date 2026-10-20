/**
 * Runner sesi: menjembatani peristiwa mentah perangkat (termasuk transkrip ucapan)
 * ke mesin murni. Hanya di sini ada I/O ke Jev / Claude, dan hanya di sini ada jam.
 */
import { langkah, mulai, type Efek, type Keadaan, type Langkah, type Peristiwa, TOPIK_KEADAAN, type Tag } from "./mesin.js";
import { giliranUntuk } from "./naskah.js";
import { AMBANG, pahami, type Ambang, type Jejak, type Penilai } from "./pemahaman.js";
import type { Topik } from "./pertanyaan.js";
import { samarkan } from "./samarkan.js";
import { daftarOpsi } from "./pertanyaan.js";

export type PeristiwaMentah =
  | Exclude<Peristiwa, { tipe: "JAWABAN" }>
  | { readonly tipe: "UCAPAN_PASIEN"; readonly transkrip: string }
  /** Ketukan tombol opsi di layar kios: jawaban pasti tanpa AI. Darurat hanya diperiksa pada ucapan. */
  | { readonly tipe: "SENTUH_OPSI"; readonly opsi: string };

export interface LangkahSesi extends Langkah {
  readonly jejak?: Jejak;
}

/**
 * Batas waktu NILAI AWAL; dikalibrasi saat pilot.
 * Target BPJS untuk tahap pendaftaran ±10 menit, jadi satu sesi Sapa harus jauh di bawahnya.
 */
export const WAKTU = {
  /** Pasien diam selama ini → DIAM: mesin mengulang pertanyaan sekali, lalu memanggil petugas. */
  giliranMs: 30_000,
  /** Sesi melewati ini → WAKTU_HABIS: petugas dipanggil. */
  sesiMs: 300_000,
} as const;
export type Waktu = { readonly [K in keyof typeof WAKTU]: number };

export function topikUntuk(tag: Tag): Topik | null {
  return (TOPIK_KEADAAN as Partial<Record<Tag, Topik>>)[tag] ?? null;
}

export async function proses(s: Keadaan, pm: PeristiwaMentah, penilai: Penilai, ambang: Ambang = AMBANG): Promise<LangkahSesi> {
  if (pm.tipe === "SENTUH_OPSI") {
    const t = topikUntuk(s.tag);
    if (!t || !(daftarOpsi(t) as string[]).includes(pm.opsi)) {
      return { berikut: s, efek: [{ efek: "audit", catatan: { jenis: "diabaikan", peristiwa: "JAWABAN", di: s.tag } }] };
    }
    // Aman: opsi sudah dicek milik topik keadaan ini (sama seperti keluaran `pahami`).
    return langkah(s, { tipe: "JAWABAN", topik: t, hasil: { jenis: "pasti", opsi: pm.opsi, sumber: "sentuh" } } as Extract<Peristiwa, { tipe: "JAWABAN" }>);
  }
  if (pm.tipe !== "UCAPAN_PASIEN") return langkah(s, pm);
  const topik = topikUntuk(s.tag);
  if (!topik) {
    return { berikut: s, efek: [{ efek: "audit", catatan: { jenis: "diabaikan", peristiwa: "JAWABAN", di: s.tag } }] };
  }
  const m = { pertanyaanKios: giliranUntuk(s).subtitle, ujaran: samarkan(pm.transkrip) };
  switch (topik) {
    case "mode": {
      const r = await pahami("mode", m, penilai, ambang);
      return { ...langkah(s, { tipe: "JAWABAN", topik, hasil: r.hasil }), jejak: r.jejak };
    }
    case "izin": {
      const r = await pahami("izin", m, penilai, ambang);
      return { ...langkah(s, { tipe: "JAWABAN", topik, hasil: r.hasil }), jejak: r.jejak };
    }
    case "kunjungan": {
      const r = await pahami("kunjungan", m, penilai, ambang);
      return { ...langkah(s, { tipe: "JAWABAN", topik, hasil: r.hasil }), jejak: r.jejak };
    }
    case "konfirmasi": {
      const r = await pahami("konfirmasi", m, penilai, ambang);
      return { ...langkah(s, { tipe: "JAWABAN", topik, hasil: r.hasil }), jejak: r.jejak };
    }
  }
}

/** Keadaan yang sudah di tangan petugas (atau selesai): jam berhenti berpengaruh. */
const tanpaJam = (tag: Tag) => tag === "MEMANGGIL_PETUGAS" || tag === "MENUNGGU_PETUGAS_CEK" || tag === "SELESAI";

/**
 * Satu sesi kios dengan jam. Peristiwa diproses berurutan (tidak ada dua transisi dari keadaan yang sama).
 * Server memanggil `tick()` tiap detik; `jam` disuntik supaya bisa diuji tanpa menunggu.
 */
export function buatSesi(hariIni: string, penilai: Penilai, jam: () => number = Date.now, waktu: Waktu = WAKTU) {
  const r = mulai(hariIni);
  let s = r.berikut;
  const mulaiSesi = jam();
  let mulaiGiliran = mulaiSesi;
  let tertunda = 0;
  let antrean: Promise<unknown> = Promise.resolve();

  async function jalankan(pm: PeristiwaMentah): Promise<LangkahSesi> {
    const hasil = await proses(s, pm, penilai);
    const sekarang = jam();
    if (hasil.efek.some((e) => e.efek === "bicara")) mulaiGiliran = sekarang;
    const baruSelesai = hasil.berikut.tag === "SELESAI" && s.tag !== "SELESAI";
    s = hasil.berikut;
    if (!baruSelesai) return hasil;
    const durasi: Efek = { efek: "audit", catatan: { jenis: "durasi_sesi", ms: sekarang - mulaiSesi } };
    return { ...hasil, efek: [...hasil.efek, durasi] };
  }

  function kirim(pm: PeristiwaMentah): Promise<LangkahSesi> {
    tertunda++;
    const hasil = antrean.then(() => jalankan(pm)).finally(() => tertunda--);
    antrean = hasil.catch(() => undefined);
    return hasil;
  }

  /** WAKTU_HABIS / DIAM bila batas lewat, atau null. Tidak menyela peristiwa yang sedang diproses. */
  function tick(): Promise<LangkahSesi> | null {
    if (tertunda > 0 || tanpaJam(s.tag)) return null;
    const sekarang = jam();
    if (sekarang - mulaiSesi >= waktu.sesiMs) return kirim({ tipe: "WAKTU_HABIS" });
    if (sekarang - mulaiGiliran >= waktu.giliranMs) return kirim({ tipe: "DIAM" });
    return null;
  }

  /** `mulai`: waktu sesi dimulai (ms), untuk durasi berjalan di dashboard petugas. */
  return { awal: r.efek, mulai: mulaiSesi, keadaan: () => s, kirim, tick };
}
