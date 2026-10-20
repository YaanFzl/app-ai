/**
 * Pengganti layanan untuk tes, dipasang lewat opsi `fetch` milik klien ASLI
 * (klien native Jev dan SDK Anthropic). Jadi yang diuji adalah payload HTTP yang betul-betul
 * dikirim, serta parsing respons oleh klien itu.
 */
import Anthropic from "@anthropic-ai/sdk";
import { buatKlienJev } from "../src/jev.js";
import type { Booking, IdentitasKartu, DokumenOcr } from "../src/domain.js";
import { BookingSchema, IdentitasKartuSchema, DokumenOcrSchema } from "../src/domain.js";
import { buatPenilaiClaude, buatPenilaiJev, type Penilai } from "../src/pemahaman.js";

export interface JawabJev { choice: string; confidence: number; noul?: number; darurat?: number }
export interface JawabClaude { opsi: string; minta_petugas: boolean; darurat?: boolean }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function jevPalsu(tabel: (ujaran: string) => JawabJev | "galat") {
  const permintaan: any[] = [];
  const client = buatKlienJev({
    kunci: "kunci-uji",
    batasWaktuMs: 1000,
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body));
      permintaan.push({ url: String(url), body, headers: init?.headers, method: init?.method });
      const j = tabel(body.state.jawaban_pasien);
      if (j === "galat") return json({ error: "service unavailable" }, 503);
      const labels = Object.keys(body.questions.jawaban.criteria);
      const sisa = (1 - j.confidence) / Math.max(1, labels.length - 1);
      return json({
        model: "jev-latest",
        answers: {
          jawaban: {
            type: "choice",
            choice: j.choice,
            confidence: j.confidence,
            probabilities: Object.fromEntries(labels.map((l) => [l, l === j.choice ? j.confidence : sisa])),
          },
          minta_petugas: { type: "noul", noul: j.noul ?? 0.02 },
          darurat: { type: "noul", noul: j.darurat ?? 0.01 },
        },
        usage: { input_tokens: 40, output_tokens: 0 },
      });
    },
  });
  return { penilai: buatPenilaiJev(client), permintaan };
}

export function claudePalsu(tabel: (ujaran: string) => JawabClaude | "galat") {
  const permintaan: any[] = [];
  const client = new Anthropic({
    apiKey: "kunci-uji",
    maxRetries: 0,
    fetch: async (url: any, init: any) => {
      const body = JSON.parse(String(init?.body));
      permintaan.push({ url: String(url), body });
      const isi = JSON.parse(body.messages[0].content);
      const j = tabel(isi.jawaban_pasien);
      if (j === "galat") return json({ type: "error", error: { type: "overloaded_error", message: "overloaded" } }, 529);
      return json({
        id: "msg_uji",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "tool_use", id: "toolu_uji", name: "pilih_opsi", input: { darurat: false, ...j } }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 20 },
      });
    },
  });
  return { penilai: buatPenilaiClaude(client), permintaan };
}

export function penilaiPalsu(j: (u: string) => JawabJev | "galat", c: (u: string) => JawabClaude | "galat"): Penilai & {
  reqJev: any[];
  reqClaude: any[];
} {
  const a = jevPalsu(j);
  const b = claudePalsu(c);
  return { jev: a.penilai, claude: b.penilai, reqJev: a.permintaan, reqClaude: b.permintaan };
}

// ---------------------------------------------------------------- data fiktif (bukan data peserta riil)
export const KARTU_SITI: IdentitasKartu = IdentitasKartuSchema.parse({
  sumber: "kartu_jkn",
  nik: "3273010101550001",
  nomorKartu: "0001234567890",
  nama: "Siti Aminah",
  tanggalLahir: "1955-01-01",
  jenisKelamin: "P",
  statusPeserta: "aktif",
});

export const KARTU_AHMAD: IdentitasKartu = IdentitasKartuSchema.parse({
  sumber: "ktp",
  nik: "3273010202480002",
  nama: "Ahmad Sujono",
  tanggalLahir: "1948-02-02",
  jenisKelamin: "L",
  statusPeserta: "aktif",
});

export function rujukanUntuk(k: IdentitasKartu, ubah: Partial<Record<"nama" | "berlakuSampai", string>> = {}, keyakinan = 0.95): DokumenOcr {
  return DokumenOcrSchema.parse({
    jenis: "rujukan_fktp",
    nama: { nilai: ubah.nama ?? k.nama, keyakinan },
    nik: { nilai: k.nik, keyakinan },
    poliTujuan: { nilai: "penyakit_dalam", keyakinan },
    berlakuSampai: { nilai: ubah.berlakuSampai ?? "2026-12-31", keyakinan },
  });
}

export const HARI_INI = "2026-10-12";

export const BOOKING_SITI: Booking = BookingSchema.parse({
  kodeBooking: "BK2026101200017",
  nomorAntrean: "PD-017",
  poli: "penyakit_dalam",
  tanggalPeriksa: HARI_INI,
  jamPraktik: "08:00-12:00",
});
