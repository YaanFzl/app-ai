/**
 * Satu kios = paling banyak satu sesi aktif. Sesi baru hanya boleh dimulai bila belum ada sesi
 * atau sesi lama sudah SELESAI; selama MEMANGGIL_PETUGAS kios terkunci sampai PETUGAS_SELESAI.
 */
import { randomUUID } from "node:crypto";
import type { Keadaan } from "./mesin.js";

export function buatKios<S extends { keadaan(): Keadaan }>(buatSesi: () => S) {
  let aktif: { readonly idSesi: string; readonly sesi: S } | null = null;
  return {
    /** `null` = ditolak karena sesi aktif belum selesai. */
    mulaiSesi() {
      if (aktif && aktif.sesi.keadaan().tag !== "SELESAI") return null;
      aktif = { idSesi: randomUUID(), sesi: buatSesi() };
      return aktif;
    },
    aktif: () => aktif,
  };
}
