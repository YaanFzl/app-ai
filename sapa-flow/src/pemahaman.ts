/**
 * Memahami jawaban lisan pasien → SATU opsi tertutup.
 *
 *   Jev (System One, TypeSafe)  : penilai utama tiap giliran. Choice + Noul, probabilitas terkalibrasi.
 *   Claude Haiku 5.5            : pendapat kedua hanya saat Jev "nanggung", lewat strict tool use.
 *   Kata kunci (tanpa AI)       : mode darurat bila layanan AI terputus.
 *
 * Tidak ada model yang mengarang kalimat untuk pasien. Kalimat Sapa tetap dari `naskah.ts`.
 */
import type { KlienJev, ResponsJev } from "./jev.js";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  DESKRIPSI_TIDAK_JELAS,
  INSTRUKSI_DARURAT,
  INSTRUKSI_MINTA_PETUGAS,
  PERTANYAAN,
  TIDAK_JELAS,
  daftarOpsi,
  type Opsi,
  type Topik,
} from "./pertanyaan.js";
import type { UjaranTersamar } from "./samarkan.js";

// ---------------------------------------------------------------- tipe hasil
export type OpsiAtauTidakJelas<T extends Topik> = Opsi<T> | typeof TIDAK_JELAS;

export type Pemahaman<T extends Topik> =
  | { readonly jenis: "pasti"; readonly opsi: Opsi<T>; readonly sumber: "jev" | "jev+claude" | "claude" | "kata_kunci" | "sentuh" }
  | { readonly jenis: "tanya_ulang"; readonly sebab: "tidak_jelas" | "ragu" | "beda_pendapat" | "layanan_terputus" }
  | { readonly jenis: "minta_petugas" }
  /** Keselamatan di atas segalanya: diperiksa di SETIAP giliran, sebelum opsi apa pun. */
  | { readonly jenis: "darurat" };

export interface Masukan {
  /** Kalimat yang baru saja ditampilkan Sapa (konteks untuk penilai). */
  readonly pertanyaanKios: string;
  readonly ujaran: UjaranTersamar;
}

/** Jejak keputusan untuk audit & kalibrasi ambang saat pilot. */
export interface Jejak {
  jev?: { opsi: string; keyakinan: number; pMintaPetugas: number; pDarurat: number; usage: ResponsJev["usage"] } | { galat: string };
  claude?: { opsi: string; mintaPetugas: boolean; darurat: boolean } | { galat: string };
  kataKunci?: { opsi: string; darurat: boolean };
}

// ---------------------------------------------------------------- penilai (dapat diganti di tes)
export interface HasilJev<T extends Topik> {
  readonly opsi: OpsiAtauTidakJelas<T>;
  readonly keyakinan: number;
  readonly pMintaPetugas: number;
  readonly pDarurat: number;
  readonly usage: ResponsJev["usage"];
}
export interface PenilaiCepat {
  nilai<T extends Topik>(topik: T, m: Masukan): Promise<HasilJev<T>>;
}
export interface HasilClaude<T extends Topik> {
  readonly opsi: OpsiAtauTidakJelas<T>;
  readonly mintaPetugas: boolean;
  readonly darurat: boolean;
}
export interface PenilaiKedua {
  nilai<T extends Topik>(topik: T, m: Masukan): Promise<HasilClaude<T>>;
}

/**
 * Ambang AWAL. Dokumentasi Jev menegaskan ambang harus dikalibrasi per pertanyaan
 * dengan data sendiri; nilai ini diganti setelah uji relawan (lihat eval/).
 */
export const AMBANG = {
  terimaLangsung: 0.6,
  mintaPendapatKedua: 0.3,
  mintaPetugas: 0.7,
  /** Sengaja rendah: lebih baik petugas datang tanpa perlu daripada terlewat. */
  darurat: 0.3,
} as const;
export type Ambang = { readonly [K in keyof typeof AMBANG]: number };

// ---------------------------------------------------------------- Jev
function kriteria<T extends Topik>(topik: T): Record<OpsiAtauTidakJelas<T>, string> {
  return { ...PERTANYAAN[topik].opsi, [TIDAK_JELAS]: DESKRIPSI_TIDAK_JELAS } as Record<OpsiAtauTidakJelas<T>, string>;
}

/** Tiga pertanyaan independen dalam satu permintaan; batas waktu dan larangan coba ulang ada di `jev.ts`. */
export function buatPenilaiJev(jev: KlienJev): PenilaiCepat {
  return {
    async nilai<T extends Topik>(topik: T, m: Masukan): Promise<HasilJev<T>> {
      const r = await jev.panggil(
        { pertanyaan_kios: m.pertanyaanKios, jawaban_pasien: m.ujaran },
        {
          jawaban: { type: "choice", instructions: PERTANYAAN[topik].instruksi, criteria: kriteria(topik) },
          minta_petugas: { type: "noul", instructions: INSTRUKSI_MINTA_PETUGAS },
          darurat: { type: "noul", instructions: INSTRUKSI_DARURAT },
        },
      );
      const { jawaban, minta_petugas, darurat } = r.answers;
      if (jawaban?.type !== "choice" || minta_petugas?.type !== "noul" || darurat?.type !== "noul") throw new Error("Jev: jenis jawaban tidak sesuai pertanyaan");
      const opsiSah = [...Object.keys(PERTANYAAN[topik].opsi), TIDAK_JELAS];
      if (!opsiSah.includes(jawaban.choice)) throw new Error(`Jev: opsi di luar daftar (${jawaban.choice})`);
      return {
        opsi: jawaban.choice as OpsiAtauTidakJelas<T>,
        keyakinan: jawaban.confidence,
        pMintaPetugas: minta_petugas.noul,
        pDarurat: darurat.noul,
        usage: r.usage,
      };
    },
  };
}

// ---------------------------------------------------------------- Claude (strict tool use)
export const MODEL_CLAUDE = "claude-haiku-5-5";
const NAMA_ALAT = "pilih_opsi";

const SISTEM_CLAUDE = [
  "Kamu komponen klasifikasi di kios pendaftaran rumah sakit di Indonesia.",
  "Pengguna sering lansia; jawabannya bisa santai, terpotong, atau bercampur bahasa daerah (Jawa, Sunda, dll.).",
  "Pilih tepat satu opsi yang paling sesuai dengan maksud pasien. Jika ragu, pilih tidak_jelas. Jangan menebak.",
  "Isi minta_petugas = true hanya jika pasien jelas meminta dibantu petugas/manusia.",
  "Isi darurat = true jika pasien menyebut keluhan yang mungkin gawat darurat (nyeri dada hebat, sesak berat, hampir pingsan, lemas mendadak).",
].join(" ");

export function buatPenilaiClaude(client: Anthropic, model: string = MODEL_CLAUDE): PenilaiKedua {
  return {
    async nilai<T extends Topik>(topik: T, m: Masukan): Promise<HasilClaude<T>> {
      const opsi: readonly OpsiAtauTidakJelas<T>[] = [...daftarOpsi(topik), TIDAK_JELAS];
      const res = await client.messages.create({
        model,
        max_tokens: 200,
        thinking: { type: "disabled" }, // tool_choice paksa + latensi rendah
        system: SISTEM_CLAUDE,
        tools: [
          {
            name: NAMA_ALAT,
            description: "Catat opsi yang dipilih untuk jawaban pasien.",
            strict: true,
            input_schema: {
              type: "object",
              properties: {
                opsi: { type: "string", enum: opsi },
                minta_petugas: { type: "boolean" },
                darurat: { type: "boolean" },
              },
              required: ["opsi", "minta_petugas", "darurat"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: NAMA_ALAT, disable_parallel_tool_use: true },
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              pertanyaan_kios: m.pertanyaanKios,
              jawaban_pasien: m.ujaran,
              opsi: kriteria(topik),
            }),
          },
        ],
      });
      const blok = res.content.find((b) => b.type === "tool_use");
      if (!blok || blok.type !== "tool_use") throw new Error(`Claude tidak memanggil alat (stop_reason=${res.stop_reason})`);
      // Lapisan kedua: validasi ulang meski strict mode sudah menjamin skema.
      // Docs: kapitalisasi enum tidak dijamin, jadi dinormalkan dulu.
      const Skema = z.object({
        opsi: z
          .string()
          .transform((s) => s.toLowerCase())
          .refine((s): s is OpsiAtauTidakJelas<T> => (opsi as readonly string[]).includes(s), "opsi di luar daftar"),
        minta_petugas: z.boolean(),
        darurat: z.boolean(),
      });
      const isi = Skema.parse(blok.input);
      return { opsi: isi.opsi as OpsiAtauTidakJelas<T>, mintaPetugas: isi.minta_petugas, darurat: isi.darurat };
    },
  };
}

// ---------------------------------------------------------------- kata kunci (tanpa AI)
const KATA: { readonly [T in Topik]: { readonly [O in Opsi<T>]: readonly string[] } } = {
  // Sengaja tanpa "jkn" di bpjs: "mobile jkn" akan kena dua opsi sekaligus.
  mode: {
    bpjs: ["bpjs", "kis", "askes", "kartu sehat"],
    checkin: ["booking", "mobile jkn", "aplikasi", "antrean online"],
    non_bpjs: ["umum", "bayar sendiri", "asuransi lain"],
    admission: ["rawat inap", "opname", "mondok"],
  },
  izin: {
    ya: ["ya", "iya", "iyo", "boleh", "silakan", "silahkan", "monggo", "mangga", "nggih", "enggih", "inggih", "muhun", "setuju", "lanjut", "oke"],
    tidak: ["tidak", "nggak", "gak", "ndak", "enggak", "mboten", "henteu", "jangan", "ogah", "tidak mau"],
  },
  kunjungan: {
    kontrol: ["kontrol", "kontrol rutin", "periksa lagi", "cek lagi", "balik lagi", "lanjutan", "jadwal"],
    rujukan_baru: ["rujukan", "dirujuk", "puskesmas", "klinik", "surat dari", "pertama kali"],
    lainnya: ["obat saja", "ambil obat", "jenguk", "besuk", "igd", "darurat", "tanya"],
  },
  konfirmasi: {
    ya: ["ya", "iya", "betul", "benar", "bener", "leres", "sudah", "cocok", "nggih", "muhun"],
    tidak: ["tidak", "salah", "keliru", "bukan", "belum", "nggak", "mboten", "lain"],
  },
};
const MINTA_PETUGAS_KATA = ["petugas", "suster", "perawat", "panggilkan", "sama orang", "manusia", "mbak", "mas"];
const DARURAT_KATA = ["dada sakit", "dada saya sakit", "nyeri dada", "sesak", "pingsan", "mau jatuh", "lemas sekali", "tidak bisa napas", "nggak bisa napas"];

function adaKata(teks: string, kata: string): boolean {
  // Akhiran "-nya" ikut dikenali: "petugasnya" = "petugas".
  return new RegExp(`(^|[^\\p{L}])${kata.replace(/\s+/g, "\\s+")}(nya)?($|[^\\p{L}])`, "iu").test(teks);
}

export function nilaiKataKunci<T extends Topik>(topik: T, ujaran: UjaranTersamar): { opsi: OpsiAtauTidakJelas<T>; mintaPetugas: boolean; darurat: boolean } {
  const kamus = KATA[topik] as Record<Opsi<T>, readonly string[]>;
  const kena = daftarOpsi(topik).filter((o) => kamus[o].some((k) => adaKata(ujaran, k)));
  return {
    // Tepat satu opsi yang kena = yakin. Nol atau lebih dari satu (mis. "nggak apa-apa, silakan") = tidak jelas.
    opsi: kena.length === 1 ? (kena[0] as Opsi<T>) : TIDAK_JELAS,
    mintaPetugas: MINTA_PETUGAS_KATA.some((k) => adaKata(ujaran, k)),
    darurat: DARURAT_KATA.some((k) => adaKata(ujaran, k)),
  };
}

// ---------------------------------------------------------------- kebijakan gabungan
export interface Penilai {
  readonly jev: PenilaiCepat | null;
  readonly claude: PenilaiKedua | null;
}

export async function pahami<T extends Topik>(
  topik: T,
  m: Masukan,
  p: Penilai,
  ambang: Ambang = AMBANG,
): Promise<{ hasil: Pemahaman<T>; jejak: Jejak }> {
  const jejak: Jejak = {};
  const pesan = (e: unknown) => (e instanceof Error ? e.constructor.name + ": " + e.message : String(e));

  let jev: HasilJev<T> | null = null;
  if (p.jev) {
    try {
      jev = await p.jev.nilai(topik, m);
      jejak.jev = { opsi: jev.opsi, keyakinan: jev.keyakinan, pMintaPetugas: jev.pMintaPetugas, pDarurat: jev.pDarurat, usage: jev.usage };
    } catch (e) {
      jejak.jev = { galat: pesan(e) };
    }
  }

  const tanyaClaude = async (): Promise<HasilClaude<T> | null> => {
    if (!p.claude) return null;
    try {
      const c = await p.claude.nilai(topik, m);
      jejak.claude = { opsi: c.opsi, mintaPetugas: c.mintaPetugas, darurat: c.darurat };
      return c;
    } catch (e) {
      jejak.claude = { galat: pesan(e) };
      return null;
    }
  };

  // --- Jalur normal: Jev menjawab
  if (jev) {
    if (jev.pDarurat >= ambang.darurat) return { hasil: { jenis: "darurat" }, jejak };
    if (jev.pMintaPetugas >= ambang.mintaPetugas) return { hasil: { jenis: "minta_petugas" }, jejak };
    if (jev.keyakinan >= ambang.terimaLangsung) {
      return jev.opsi === TIDAK_JELAS
        ? { hasil: { jenis: "tanya_ulang", sebab: "tidak_jelas" }, jejak }
        : { hasil: { jenis: "pasti", opsi: jev.opsi, sumber: "jev" }, jejak };
    }
    if (jev.keyakinan >= ambang.mintaPendapatKedua) {
      const c = await tanyaClaude();
      if (!c) return { hasil: { jenis: "tanya_ulang", sebab: "ragu" }, jejak };
      if (c.darurat) return { hasil: { jenis: "darurat" }, jejak };
      if (c.mintaPetugas) return { hasil: { jenis: "minta_petugas" }, jejak };
      if (c.opsi === jev.opsi && c.opsi !== TIDAK_JELAS) {
        return { hasil: { jenis: "pasti", opsi: c.opsi, sumber: "jev+claude" }, jejak };
      }
      return { hasil: { jenis: "tanya_ulang", sebab: "beda_pendapat" }, jejak };
    }
    return { hasil: { jenis: "tanya_ulang", sebab: "ragu" }, jejak };
  }

  // --- Jev terputus: Claude sebagai penilai tunggal
  const c = await tanyaClaude();
  if (c) {
    if (c.darurat) return { hasil: { jenis: "darurat" }, jejak };
    if (c.mintaPetugas) return { hasil: { jenis: "minta_petugas" }, jejak };
    return c.opsi === TIDAK_JELAS
      ? { hasil: { jenis: "tanya_ulang", sebab: "tidak_jelas" }, jejak }
      : { hasil: { jenis: "pasti", opsi: c.opsi, sumber: "claude" }, jejak };
  }

  // --- Keduanya terputus: mode darurat kata kunci (ditandai di audit)
  const k = nilaiKataKunci(topik, m.ujaran);
  jejak.kataKunci = { opsi: k.opsi, darurat: k.darurat };
  if (k.darurat) return { hasil: { jenis: "darurat" }, jejak };
  if (k.mintaPetugas) return { hasil: { jenis: "minta_petugas" }, jejak };
  return k.opsi === TIDAK_JELAS
    ? { hasil: { jenis: "tanya_ulang", sebab: "layanan_terputus" }, jejak }
    : { hasil: { jenis: "pasti", opsi: k.opsi, sumber: "kata_kunci" }, jejak };
}
