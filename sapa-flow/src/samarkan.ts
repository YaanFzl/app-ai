/**
 * Ujaran pasien disamarkan sebelum keluar dari kios (ke Jev atau Claude).
 * UU 27/2022: data minimal. Angka (NIK, nomor kartu, tanggal) diganti token,
 * dan panjang dibatasi. Fungsi pemahaman HANYA menerima `UjaranTersamar`.
 */
declare const tersamar: unique symbol;
export type UjaranTersamar = string & { readonly [tersamar]: true };

export const PANJANG_MAKS_UJARAN = 240;

export function samarkan(transkrip: string): UjaranTersamar {
  const bersih = transkrip
    .normalize("NFKC")
    .replace(/\d[\d\s.\-/]*\d|\d/g, "[angka]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PANJANG_MAKS_UJARAN);
  return bersih as UjaranTersamar;
}
