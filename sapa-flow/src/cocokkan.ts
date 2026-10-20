/**
 * Pencocokan data kartu vs dokumen (deterministik, tanpa AI).
 * Hasilnya bendera untuk petugas dan lapisan deteksi; OCR tidak membuktikan keaslian dokumen.
 */
import type { BenderaData, DokumenOcr, IdentitasKartu } from "./domain.js";

/** Jaro-Winkler: tahan beda ejaan nama umum (Muhamad/Muhammad, Siti/Sitti). */
export function jaroWinkler(a0: string, b0: string): number {
  const a = a0.toLowerCase().replace(/[^a-z]/g, "");
  const b = b0.toLowerCase().replace(/[^a-z]/g, "");
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const jarak = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const ma = new Array<boolean>(a.length).fill(false);
  const mb = new Array<boolean>(b.length).fill(false);
  let cocok = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - jarak); j < Math.min(b.length, i + jarak + 1); j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; cocok++; break; }
    }
  }
  if (!cocok) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (cocok / a.length + cocok / b.length + (cocok - t / 2) / cocok) / 3;
  let awalan = 0;
  while (awalan < 4 && a[awalan] === b[awalan]) awalan++;
  return jaro + awalan * 0.1 * (1 - jaro);
}

export const AMBANG_NAMA = 0.9;
export const AMBANG_OCR = 0.8;

export function cocokkan(kartu: IdentitasKartu, dok: DokumenOcr, hariIni: string): BenderaData[] {
  const bendera: BenderaData[] = [];
  const mirip = jaroWinkler(kartu.nama, dok.nama.nilai);
  if (mirip < AMBANG_NAMA) bendera.push({ kolom: "nama", kemiripan: Math.round(mirip * 100) / 100 });
  if (dok.nik && dok.nik.nilai !== kartu.nik) bendera.push({ kolom: "nik" });
  if (dok.nomorKartu && kartu.nomorKartu && dok.nomorKartu.nilai !== kartu.nomorKartu) bendera.push({ kolom: "nomorKartu" });
  if (dok.tanggalLahir && dok.tanggalLahir.nilai !== kartu.tanggalLahir) bendera.push({ kolom: "tanggalLahir" });
  if (dok.berlakuSampai.nilai < hariIni) bendera.push({ kolom: "rujukan_kedaluwarsa" });
  for (const [nama, kolom] of Object.entries(dok)) {
    if (typeof kolom === "object" && kolom && "keyakinan" in kolom && kolom.keyakinan < AMBANG_OCR) {
      bendera.push({ kolom: "ocr_ragu", kolomRagu: nama });
    }
  }
  return bendera;
}
