/**
 * Ucapan TTS yang aman-tipe.
 *
 * - `Ucapan` hanya bisa dibuat lewat `ucap` (tagged template).
 * - Nilai yang boleh disisipkan hanya `Sapaan` atau angka kecil (mis. nomor percobaan).
 *   Memasukkan `Pribadi<"Nama">`, `Pribadi<"NIK">`, atau `Poli` = ERROR KOMPILASI.
 * - Pemeriksaan runtime menolak deret digit panjang sebagai lapisan kedua.
 */
import type { Sapaan } from "./domain.js";

declare const ucapanMerek: unique symbol;
export type Ucapan = string & { readonly [ucapanMerek]: true };

type BolehDiucapkan = Sapaan | 1 | 2 | 3;

export function ucap(bagian: TemplateStringsArray, ...nilai: BolehDiucapkan[]): Ucapan {
  const teks = bagian.reduce((acc, b, i) => acc + b + (i < nilai.length ? String(nilai[i]) : ""), "");
  if (/\d{4,}/.test(teks)) throw new Error(`Ucapan mengandung deret angka panjang: "${teks}"`);
  return teks as Ucapan;
}

/** Ekspresi avatar Sapa; sama dengan empat pose di slide + satu pose netral. */
export type Ekspresi = "menyapa" | "mendengar" | "memandu" | "petugas" | "senang";

/** Satu giliran bicara Sapa: suara, subtitle, dan pose avatar selalu datang bersama. */
export interface Giliran {
  readonly ucapan: Ucapan;
  /** Teks besar di layar. Dibatasi 64 karakter agar terbaca lansia (diuji). */
  readonly subtitle: string;
  readonly ekspresi: Ekspresi;
  /** Tempo TTS relatif; lansia dipelankan. */
  readonly tempo: 0.85 | 0.9 | 1;
}
