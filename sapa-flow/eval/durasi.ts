/**
 * Durasi sesi per skenario mock: alur ASLI (mesin + runner + pengemudi + server mock BPJS) dengan JAM SIMULASI.
 * Waktu dinding tidak berarti di sini (sesi mock selesai dalam milidetik), jadi setiap keadaan diberi biaya
 * dari MODEL_WAKTU dan durasi dibaca dari audit `durasi_sesi` milik runner.
 * Hasilnya ESTIMASI MODEL, bukan pengukuran; kalibrasi MODEL_WAKTU dengan rekaman uji relawan.
 */
import { tuntas, type Keadaan, type Tag } from "../src/mesin.js";
import { OPSI_BAWAAN, mainkan, siapkanBpjsMock, type OpsiDemo } from "../src/mock/demo.js";
import { giliranUntuk } from "../src/naskah.js";
import { buatSesi } from "../src/sesi.js";

/** Detik. NILAI AWAL tebakan tim (lansia, kios RS); ganti setelah pilot. */
export const MODEL_WAKTU = {
  /** Kecepatan TTS id-ID pada tempo 1 (huruf per detik); dibagi tempo naskah (0,85 / 0,9 / 1). */
  hurufPerDetikTts: 14,
  /** Lansia berpikir lalu menjawab satu pertanyaan tertutup. */
  jawabLisan: 6,
  /** Membaca ringkasan data di layar sebelum menjawab konfirmasi. */
  bacaKonfirmasi: 20,
  /** Mengeluarkan dan meletakkan kartu / surat / layar HP di pemindai. */
  pindai: 20,
  wajahPerPercobaan: 6,
  sidikJariPerPercobaan: 8,
  /** Petugas memeriksa draf di dashboard lalu menekan Setuju / Ambil alih. */
  petugasCek: 60,
  /** Petugas berjalan ke kios setelah dipanggil. */
  petugasDatang: 90,
  /** Layanan manual sesudah petugas tiba, sampai menekan Selesai. */
  petugasMelayani: 240,
} as const;
export type ModelWaktu = { readonly [K in keyof typeof MODEL_WAKTU]: number };

/** Waktu yang dihabiskan di keadaan `s` sampai peristiwa berikutnya, termasuk Sapa bicara. */
export function biayaKeadaan(s: Keadaan, w: ModelWaktu = MODEL_WAKTU): number {
  if (s.tag === "SELESAI") return 0;
  const g = giliranUntuk(s);
  const tts = g.ucapan.length / (w.hurufPerDetikTts * g.tempo);
  switch (s.tag) {
    case "TANYA_MODE":
    case "SAPA_IZIN":
    case "TANYA_KUNJUNGAN":
      return tts + w.jawabLisan;
    case "KONFIRMASI_DATA":
      return tts + w.bacaKonfirmasi + w.jawabLisan;
    case "MINTA_KARTU":
    case "MINTA_KODE_BOOKING":
    case "SCAN_DOKUMEN":
      return tts + w.pindai;
    case "VERIFIKASI_WAJAH":
      return tts + w.wajahPerPercobaan;
    case "VERIFIKASI_SIDIK_JARI":
      return tts + w.sidikJariPerPercobaan;
    case "MENUNGGU_PETUGAS_CEK":
      return tts + w.petugasCek;
    case "MEMANGGIL_PETUGAS":
      return tts + (s.datang ? w.petugasMelayani : w.petugasDatang);
    default:
      return tuntas(s);
  }
}

export const SKENARIO_DURASI: readonly { readonly nama: string; readonly opsi: OpsiDemo }[] = [
  { nama: "BPJS kontrol, RM ada", opsi: OPSI_BAWAAN },
  { nama: "BPJS rujukan baru", opsi: { ...OPSI_BAWAAN, kunjungan: "rujukan" } },
  { nama: "RM belum ada → admisi", opsi: { ...OPSI_BAWAAN, peserta: "ahmad" } },
  { nama: "Check-in kode booking", opsi: { ...OPSI_BAWAAN, mode: "checkin" } },
  { nama: "Check-in tanpa booking → petugas", opsi: { ...OPSI_BAWAAN, mode: "checkin", peserta: "ahmad" } },
  { nama: "Wajah gagal → sidik jari", opsi: { ...OPSI_BAWAAN, wajah: "gagal" } },
  { nama: "Wajah + sidik jari tidak cocok → petugas", opsi: { ...OPSI_BAWAAN, peserta: "budi", wajah: "tidakcocok", sidikjari: "tidakcocok" } },
  { nama: "Peserta nonaktif → petugas", opsi: { ...OPSI_BAWAAN, peserta: "rina" } },
  { nama: "Kartu tak dikenal → petugas", opsi: { ...OPSI_BAWAAN, peserta: "takdikenal" } },
  { nama: "Kartu gagal dibaca → petugas", opsi: { ...OPSI_BAWAAN, kartu: "gagal" } },
  { nama: "Dokumen ragu → petugas cek", opsi: { ...OPSI_BAWAAN, dokumen: "ragu" } },
  { nama: "Data dikoreksi pasien → petugas", opsi: { ...OPSI_BAWAAN, konfirmasi: "tidak" } },
  { nama: "Non BPJS → petugas", opsi: { ...OPSI_BAWAAN, mode: "nonbpjs" } },
  { nama: "Admission → petugas", opsi: { ...OPSI_BAWAAN, mode: "admission" } },
];

export interface HasilDurasi {
  readonly nama: string;
  readonly hasil: string | null;
  readonly jalur: readonly Tag[];
  /** Dari audit `durasi_sesi` runner (detik); null bila sesi tidak selesai. */
  readonly detik: number | null;
  /** Detik keadaan yang jamnya dihentikan runner (petugas sudah memegang sesi). */
  readonly detikPetugas: number;
}

export async function simulasiDurasi(hariIni: string, skenario = SKENARIO_DURASI, w: ModelWaktu = MODEL_WAKTU): Promise<HasilDurasi[]> {
  const { klien, tutup } = await siapkanBpjsMock(hariIni);
  try {
    const hasil: HasilDurasi[] = [];
    for (const { nama, opsi } of skenario) {
      let t = 0; // detik simulasi
      let detikPetugas = 0;
      const durasi = { ms: null as number | null };
      const maju = (s: Keadaan) => {
        const b = biayaKeadaan(s, w);
        t += b;
        if (s.tag === "MEMANGGIL_PETUGAS" || s.tag === "MENUNGGU_PETUGAS_CEK") detikPetugas += b;
      };
      const sesi = buatSesi(hariIni, { jev: null, claude: null }, () => t * 1000);
      maju(sesi.keadaan());
      const r = await mainkan(opsi, {
        klien,
        hariIni,
        sesi,
        setelahKirim: maju, // dipanggil SETELAH runner menghitung durasi untuk peristiwa ini
        bagikan: (e) => {
          if (e.efek === "audit" && e.catatan.jenis === "durasi_sesi") durasi.ms = e.catatan.ms;
        },
      });
      hasil.push({ nama, hasil: r.hasil, jalur: r.jalur, detik: durasi.ms === null ? null : durasi.ms / 1000, detikPetugas });
    }
    return hasil;
  } finally {
    tutup();
  }
}
