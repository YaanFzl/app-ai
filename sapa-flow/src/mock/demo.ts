/**
 * Demo ujung-ke-ujung tanpa perangkat: mesin + runner + pengemudi + adaptor palsu + server mock BPJS.
 * Panel demo berperan sebagai pasien, perangkat, dan petugas. Pemahaman memakai kata kunci saja (tanpa AI).
 * Dipakai `npm run demo` (scripts/demo.ts) dan test/adaptor.test.ts.
 */
import type { AddressInfo } from "node:net";
import { buatPengemudi, type Pengemudi } from "../adaptor/pengemudi.js";
import { buatKlienBpjs, type KlienBpjs } from "../bpjs/klien.js";
import { DokumenOcrSchema, type HasilFrista, type HasilSidikJari } from "../domain.js";
import type { Efek, Keadaan, Tag } from "../mesin.js";
import { buatSesi } from "../sesi.js";
import { buatAdaptorPalsu } from "./adaptor-palsu.js";
import { buatServerMock } from "./server.js";

export const PESERTA = {
  siti: { nomorKartu: "0001234567890", kodeBooking: "BK2026101200017" },
  ahmad: { nomorKartu: "0001234567891" },
  rina: { nomorKartu: "0001234567892" },
  budi: { nomorKartu: "0001234567893" },
  dewi: { nomorKartu: "0001234567894" },
  joko: { nomorKartu: "0001234567895" },
  wati: { nomorKartu: "0001234567896", kodeBooking: "BK2026101200018" },
  takdikenal: { nomorKartu: "0009999999999" },
} as const;

const UCAP_MODE = { bpjs: "pakai BPJS", checkin: "sudah booking di Mobile JKN", nonbpjs: "umum saja, bayar sendiri", admission: "mau rawat inap" } as const;
const WAJAH: Record<"lolos" | "gagal" | "tidakcocok", HasilFrista> = {
  lolos: { hasil: "cocok" },
  gagal: { hasil: "wajah_tidak_terdeteksi", sebab: "gelap" },
  tidakcocok: { hasil: "tidak_cocok" },
};
const JARI: Record<"lolos" | "gagal" | "tidakcocok", HasilSidikJari> = {
  lolos: { hasil: "cocok" },
  gagal: { hasil: "tidak_terbaca" },
  tidakcocok: { hasil: "tidak_cocok" },
};

export interface OpsiDemo {
  readonly mode: keyof typeof UCAP_MODE;
  readonly peserta: keyof typeof PESERTA;
  readonly kartu: "terbaca" | "gagal";
  readonly wajah: keyof typeof WAJAH;
  readonly sidikjari: keyof typeof JARI;
  readonly kunjungan: "kontrol" | "rujukan";
  /** ragu: nama di dokumen sedikit beda dan sudah kedaluwarsa → kolom ragu untuk petugas. */
  readonly dokumen: "cocok" | "ragu";
  readonly konfirmasi: "ya" | "tidak";
  readonly petugas: "setuju" | "ambilalih";
}
export const OPSI_BAWAAN: OpsiDemo = {
  mode: "bpjs", peserta: "siti", kartu: "terbaca", wajah: "lolos", sidikjari: "lolos", kunjungan: "kontrol", dokumen: "cocok", konfirmasi: "ya", petugas: "setuju",
};

/** Dokumen hasil OCR untuk identitas terverifikasi: cocok (berlaku 60 hari) atau ragu (nama keluarga beda, kedaluwarsa kemarin). */
function dokumenUntuk(s: Keadaan, hariIni: string, ragu: boolean) {
  const id = s.k.identitas;
  const berlaku = new Date(`${hariIni}T00:00:00Z`);
  berlaku.setUTCDate(berlaku.getUTCDate() + (ragu ? -1 : 60));
  const kolom = <T>(nilai: T) => ({ nilai, keyakinan: 0.95 });
  const nama = id?.nama ?? "-";
  return DokumenOcrSchema.parse({
    jenis: s.k.kunjungan === "rujukan_baru" ? "rujukan_fktp" : "surat_kontrol",
    // Ragu: nama keluarga beda (di bawah ambang Jaro-Winkler) dan OCR kurang yakin.
    nama: ragu ? { nilai: `${nama.split(" ")[0]} Rahmawati`, keyakinan: 0.6 } : kolom(nama),
    ...(id ? { nik: kolom(id.nik) } : {}),
    poliTujuan: kolom("penyakit_dalam"),
    berlakuSampai: kolom(berlaku.toISOString().slice(0, 10)),
  });
}

export const hariIniJakarta = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/** Server mock BPJS di port acak + klien yang mengarah ke sana. */
export async function siapkanBpjsMock(hariIni: string) {
  const kred = { consId: "demo-cons", secretKey: "demo-secret", vclaimUserKey: "demo-vclaim", antreanUserKey: "demo-antrean" };
  const server = buatServerMock({ ...kred, plain: false, izinkanLookupNik: true, hariIni, catat: () => {} });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const klien = buatKlienBpjs(
    { ...kred, vclaimUrl: `${base}/vclaim-rest`, antreanUrl: `${base}/antreanrs`, simrsUrl: `${base}/simrs`, plain: false, izinkanLookupNik: true },
    () => hariIni,
  );
  return { klien, tutup: () => server.close() };
}

export interface OpsiMainkan {
  readonly klien: KlienBpjs;
  readonly hariIni: string;
  readonly sesi: ReturnType<typeof buatSesi>;
  /** true: keputusan petugas datang dari luar (dashboard); panel hanya berperan sebagai pasien dan perangkat. */
  readonly petugasDariLuar?: boolean;
  /** true: jawaban pasien datang dari luar (ketukan di layar kios); panel hanya berperan sebagai perangkat. */
  readonly pasienDariLuar?: boolean;
  /** Jeda sebelum petugas palsu bertindak, supaya layar "menunggu petugas" sempat terlihat. */
  readonly jedaPetugasMs?: number;
  readonly lainnya?: (e: Efek) => void;
  /** Dipanggil setiap kali runner selesai memproses satu peristiwa. */
  readonly setelahKirim?: (s: Keadaan) => void;
  /** Menerima SEMUA efek (termasuk yang ditangani adaptor), mis. untuk layar kios. */
  readonly bagikan?: (e: Efek) => void;
  /** Pengemudi siap menerima keputusan petugas dari luar. */
  readonly pengemudiSiap?: (p: Pengemudi) => void;
}

/** Panel berperan sebagai operator: menjawab apa pun yang sedang ditunggu mesin, sampai SELESAI. */
export async function mainkan(o: OpsiDemo, m: OpsiMainkan) {
  const { adaptor, panel, layar } = buatAdaptorPalsu();
  panel.aturWajah(WAJAH[o.wajah]);
  panel.aturSidikJari(JARI[o.sidikjari]);
  const asli = m.sesi;
  const jalur: Tag[] = [asli.keadaan().tag];
  /** Sesi yang mencatat setiap keadaan baru, termasuk yang dilewati di dalam satu langkah pengemudi. */
  const sesi = {
    ...asli,
    kirim: async (pm: Parameters<typeof asli.kirim>[0]) => {
      const r = await asli.kirim(pm);
      if (jalur.at(-1) !== r.berikut.tag) jalur.push(r.berikut.tag);
      m.setelahKirim?.(r.berikut);
      for (const e of r.efek) m.bagikan?.(e);
      return r;
    },
  };
  const pengemudi = buatPengemudi({
    sesi,
    adaptor,
    klien: m.klien,
    lainnya: (e) => {
      if (e.efek === "tampilkan_kartu") layar.push(`[layar: ${e.isi.judul}]`);
      if (e.efek === "panggil_petugas") layar.push(`[PANGGIL PETUGAS: ${e.alasan}${e.prioritas === "segera" ? ", SEGERA" : ""}]`);
      m.lainnya?.(e);
    },
  });

  for (const e of asli.awal) m.bagikan?.(e);
  m.pengemudiSiap?.(pengemudi);
  const p = PESERTA[o.peserta];
  const tunggu = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const pasien = (f: () => void) => (m.pasienDariLuar ? tunggu(200) : f());
  for (let i = 0; (m.petugasDariLuar || m.pasienDariLuar || i < 20) && sesi.keadaan().tag !== "SELESAI"; i++) {
    await pengemudi.tenang();
    const s = sesi.keadaan();
    switch (s.tag) {
      case "TANYA_MODE": await pasien(() => panel.ucap(UCAP_MODE[o.mode])); break;
      case "SAPA_IZIN": await pasien(() => panel.ucap("iya boleh")); break;
      case "MINTA_KARTU": o.kartu === "gagal" ? panel.pindaiGagal("kartu") : panel.pindaiKartu({ nomorKartu: p.nomorKartu }); break;
      case "MINTA_KODE_BOOKING": panel.pindaiBooking("kodeBooking" in p ? p.kodeBooking : "TIDAKADA"); break;
      case "TANYA_KUNJUNGAN": await pasien(() => panel.ucap(o.kunjungan === "kontrol" ? "kontrol" : "bawa surat rujukan dari puskesmas")); break;
      case "SCAN_DOKUMEN": panel.pindaiDokumen(dokumenUntuk(s, m.hariIni, o.dokumen === "ragu")); break;
      case "KONFIRMASI_DATA": await pasien(() => panel.ucap(o.konfirmasi === "ya" ? "betul" : "bukan, salah")); break;
      case "MENUNGGU_PETUGAS_CEK":
        if (m.petugasDariLuar) await tunggu(200);
        else if (m.jedaPetugasMs) await tunggu(m.jedaPetugasMs).then(() => pengemudi.petugas(o.petugas === "setuju" ? { tipe: "PETUGAS_SETUJU", nomorAntrean: "PD-001" } : { tipe: "PETUGAS_AMBIL_ALIH" }));
        else void pengemudi.petugas(o.petugas === "setuju" ? { tipe: "PETUGAS_SETUJU", nomorAntrean: "PD-001" } : { tipe: "PETUGAS_AMBIL_ALIH" });
        break;
      case "MEMANGGIL_PETUGAS":
        if (m.petugasDariLuar) await tunggu(200);
        else {
          if (m.jedaPetugasMs) await tunggu(m.jedaPetugasMs);
          void pengemudi.petugas({ tipe: "PETUGAS_DATANG" });
          void pengemudi.petugas({ tipe: "PETUGAS_SELESAI" });
        }
        break;
      case "VERIFIKASI_WAJAH":
      case "VERIFIKASI_SIDIK_JARI":
        break; // pengemudi sudah menanyai adaptor biometrik
    }
    await pengemudi.tenang();
  }
  const akhir = sesi.keadaan();
  return { pengemudi, layar, jalur, akhir, hasil: akhir.tag === "SELESAI" ? akhir.hasil : null };
}

export async function jalankanDemo(o: OpsiDemo, hariIni = hariIniJakarta()) {
  const { klien, tutup } = await siapkanBpjsMock(hariIni);
  try {
    const { pengemudi: _p, ...r } = await mainkan(o, { klien, hariIni, sesi: buatSesi(hariIni, { jev: null, claude: null }) });
    return r;
  } finally {
    tutup();
  }
}
