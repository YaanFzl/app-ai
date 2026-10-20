/**
 * Kontrak server ↔ layar kios (SPEC 5 `/ws/kios`; sekarang SSE + POST, nanti WS).
 * Layar TIDAK menerima `Efek` mentah: draf petugas dan audit tidak pernah sampai ke browser kios.
 * Data pribadi hanya lewat `kartu` (nama, tanggal lahir, poli tampil penuh; NIK sudah disamarkan mesin).
 */
import { z } from "zod";
import type { Efek, Keadaan } from "../mesin.js";
import { daftarOpsi, type Opsi, type Topik } from "../pertanyaan.js";
import { topikUntuk } from "../sesi.js";

/** Label tombol per opsi. Mapped type: lupa satu opsi = error kompilasi. */
export const LABEL_OPSI: { readonly [T in Topik]: { readonly [O in Opsi<T>]: string } } = {
  mode: { bpjs: "BPJS / JKN / KIS", checkin: "Sudah booking Mobile JKN", non_bpjs: "Umum / bayar sendiri", admission: "Rawat inap" },
  izin: { ya: "Ya, boleh", tidak: "Tidak" },
  kunjungan: { kontrol: "Kontrol", rujukan_baru: "Rujukan baru", lainnya: "Keperluan lain" },
  konfirmasi: { ya: "Ya, sudah betul", tidak: "Ada yang salah" },
};

const EKSPRESI = z.enum(["menyapa", "mendengar", "memandu", "petugas", "senang"]);

export const KeKiosSchema = z.discriminatedUnion("t", [
  /** `tag` "SIAGA" = belum ada sesi. `opsi` = tombol jawaban untuk pertanyaan keadaan ini. */
  z.object({ t: z.literal("keadaan"), tag: z.string(), opsi: z.array(z.object({ nilai: z.string(), label: z.string() })) }),
  z.object({ t: z.literal("bicara"), subtitle: z.string(), ekspresi: EKSPRESI }),
  z.object({
    t: z.literal("kartu"),
    judul: z.string(),
    baris: z.array(z.object({ label: z.string(), nilai: z.string(), ragu: z.boolean() })),
  }),
  z.object({ t: z.literal("lampu"), target: z.enum(["pemindai", "wajah"]), nyala: z.boolean() }),
  z.object({ t: z.literal("antrean"), nomorAntrean: z.string(), arahan: z.enum(["poli", "admisi"]) }),
  z.object({ t: z.literal("petugas"), prioritas: z.enum(["biasa", "segera"]) }),
]);
export type KeKios = z.infer<typeof KeKiosSchema>;

export const DariKiosSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("mulai") }),
  z.object({ t: z.literal("tombol"), nama: z.enum(["ulangi", "petugas"]) }),
  z.object({ t: z.literal("pilih"), opsi: z.string().max(40) }),
]);
export type DariKios = z.infer<typeof DariKiosSchema>;

export function pesanKeadaan(s: Keadaan | null): KeKios {
  if (!s) return { t: "keadaan", tag: "SIAGA", opsi: [] };
  const topik = topikUntuk(s.tag);
  const label = topik ? (LABEL_OPSI[topik] as Record<string, string>) : {};
  return { t: "keadaan", tag: s.tag, opsi: topik ? daftarOpsi(topik).map((nilai) => ({ nilai, label: label[nilai] ?? nilai })) : [] };
}

/** Satu-satunya terjemahan efek ke layar. Efek lain (draf petugas, audit, kamera) tidak pernah keluar. */
export function pesanDariEfek(e: Efek): KeKios | null {
  switch (e.efek) {
    case "bicara":
      return { t: "bicara", subtitle: e.giliran.subtitle, ekspresi: e.giliran.ekspresi };
    case "tampilkan_kartu":
      return { t: "kartu", judul: e.isi.judul, baris: e.isi.baris.map((b) => ({ ...b })) };
    case "lampu":
      return { t: "lampu", target: e.target, nyala: e.nyala };
    case "cetak_antrean":
      return { t: "antrean", nomorAntrean: e.nomorAntrean, arahan: e.arahan };
    case "panggil_petugas":
      return { t: "petugas", prioritas: e.prioritas };
    default:
      return null;
  }
}
