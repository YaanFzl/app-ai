/**
 * Implementasi palsu keenam adaptor, dikendalikan dari panel demo (pengendali di memori).
 * HANYA untuk test/ dan demo. Panel HTML lewat WS menyusul di fase 1–2.
 * `layar` mencatat apa yang dilihat/didengar pasien; nilai pribadi tidak pernah lewat TTS (tipe `Giliran`).
 */
import type { DokumenOcr, HasilFrista, HasilSidikJari } from "../domain.js";
import type { Adaptor, BacaanPemindai, PeristiwaStt } from "../adaptor/antarmuka.js";

/** Hasil per percobaan; percobaan sesudah daftar habis memakai hasil terakhir. */
const ke = <T>(daftar: readonly T[], percobaan: number): T => daftar[Math.min(percobaan, daftar.length) - 1]!;

export function buatAdaptorPalsu() {
  const layar: string[] = [];
  let keStt: (u: PeristiwaStt) => void = () => {};
  let kePemindai: (b: BacaanPemindai) => void = () => {};
  let wajah: readonly HasilFrista[] = [{ hasil: "cocok" }];
  let sidikJari: readonly HasilSidikJari[] = [{ hasil: "cocok" }];

  const adaptor: Adaptor = {
    stt: { dengar: (cb) => void (keStt = cb) },
    pemindai: {
      dengar: (cb) => void (kePemindai = cb),
      lampu: (nyala) => void layar.push(`[lampu pemindai ${nyala ? "nyala" : "mati"}]`),
    },
    biometrik: {
      wajah: async (_nik, percobaan) => ke(wajah, percobaan),
      sidikJari: async (_nik, percobaan) => ke(sidikJari, percobaan),
    },
    tts: { putar: async (g) => void layar.push(`Sapa: ${g.subtitle}`) },
    kamera: {
      atur: (aksi) => void layar.push(`[kamera ${aksi}]`),
      lampu: (nyala) => void layar.push(`[lampu wajah ${nyala ? "nyala" : "mati"}]`),
    },
    printer: { cetak: async (e) => void layar.push(`[ANTREAN ${e.nomorAntrean}: ke ${e.arahan}]`) },
  };

  const panel = {
    ucap: (transkrip: string) => keStt({ tipe: "UCAPAN_PASIEN", transkrip }),
    pindaiKartu: (b: { sumber?: "kartu_jkn" | "ktp"; nik?: string; nomorKartu?: string }) => kePemindai({ jenis: "kartu", sumber: "kartu_jkn", ...b }),
    pindaiBooking: (kodeBooking: string) => kePemindai({ jenis: "booking", kodeBooking }),
    pindaiDokumen: (dokumen: DokumenOcr) => kePemindai({ jenis: "dokumen", dokumen }),
    pindaiGagal: (sasaran: "kartu" | "booking" | "dokumen") => kePemindai({ jenis: "gagal", sasaran }),
    /** Skrip hasil verifikasi untuk sesi ini (per percobaan). */
    aturWajah: (...h: [HasilFrista, ...HasilFrista[]]) => void (wajah = h),
    aturSidikJari: (...h: [HasilSidikJari, ...HasilSidikJari[]]) => void (sidikJari = h),
  };

  return { adaptor, panel, layar };
}
export type PanelDemo = ReturnType<typeof buatAdaptorPalsu>["panel"];
