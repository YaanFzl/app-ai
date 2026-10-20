/**
 * Pengemudi: satu-satunya penghubung adaptor perangkat ↔ runner sesi.
 *  - Masukan adaptor diubah jadi `PeristiwaMentah` lalu dikirim ke `sesi.kirim` (berurutan).
 *  - Bacaan kartu / kode booking diperkaya lewat VClaim + SIMRS (baca saja); null atau galat → *_GAGAL.
 *  - Saat mesin masuk keadaan verifikasi, adaptor biometrik ditanya; hasilnya masuk sebagai FRISTA / SIDIK_JARI.
 *  - `Efek[]` dibagikan ke adaptor keluaran; efek layar/petugas/audit diteruskan ke `lainnya`.
 * Pengemudi tidak memutuskan alur: semua keputusan tetap di mesin.
 */
import type { KlienBpjs } from "../bpjs/klien.js";
import type { Efek, Tag } from "../mesin.js";
import { WAKTU, type PeristiwaMentah, type buatSesi } from "../sesi.js";
import type { Adaptor, BacaanPemindai } from "./antarmuka.js";

export type PeristiwaLayar = Extract<PeristiwaMentah, { tipe: "TOMBOL_ULANGI" | "TOMBOL_PETUGAS" | "SENTUH_OPSI" }>;
export type PeristiwaPetugas = Extract<PeristiwaMentah, { tipe: "PETUGAS_DATANG" | "PETUGAS_SELESAI" | "PETUGAS_SETUJU" | "PETUGAS_AMBIL_ALIH" }>;

export interface OpsiPengemudi {
  readonly sesi: ReturnType<typeof buatSesi>;
  readonly adaptor: Adaptor;
  readonly klien: Pick<KlienBpjs, "peserta" | "statusRm" | "booking">;
  /** Efek untuk layar kios, dashboard petugas, dan audit. */
  readonly lainnya?: (e: Efek) => void;
  /** Galat tak terduga dari masukan yang datang lewat callback (pesan klien BPJS sudah disamarkan). */
  readonly galat?: (e: unknown) => void;
  /** Alat biometrik yang tak menjawab dalam batas ini dianggap tak terbaca, supaya jam sesi tetap berjalan. */
  readonly batasBiometrikMs?: number;
}

/** Bacaan hanya diperkaya bila mesin memang sedang menunggunya (data minimal: tidak ada lookup sia-sia). */
const MENUNGGU: Record<Exclude<BacaanPemindai["jenis"], "gagal">, Tag> = { kartu: "MINTA_KARTU", booking: "MINTA_KODE_BOOKING", dokumen: "SCAN_DOKUMEN" };
const GAGAL = { kartu: "KARTU_GAGAL", booking: "KODE_BOOKING_GAGAL", dokumen: "DOKUMEN_GAGAL" } as const;

export function buatPengemudi({ sesi, adaptor: a, klien, lainnya, galat = console.error, batasBiometrikMs = WAKTU.giliranMs }: OpsiPengemudi) {
  let rantai: Promise<unknown> = Promise.resolve();

  function antre(f: () => Promise<void>): Promise<void> {
    const hasil = rantai.then(f);
    rantai = hasil.catch(() => undefined);
    return hasil;
  }

  async function salurkan(efek: readonly Efek[]) {
    for (const e of efek) {
      switch (e.efek) {
        case "bicara":
          await a.tts.putar(e.giliran);
          break;
        case "kamera":
          a.kamera.atur(e.aksi);
          break;
        case "lampu":
          (e.target === "pemindai" ? a.pemindai : a.kamera).lampu(e.nyala);
          break;
        case "cetak_antrean":
          await a.printer.cetak(e);
          break;
        default:
          lainnya?.(e);
      }
    }
  }

  async function jalankan(pm: PeristiwaMentah) {
    const r = await sesi.kirim(pm);
    await salurkan(r.efek);
    await picuBiometrik();
  }

  const dalamBatas = <T>(p: Promise<T>) =>
    new Promise<T>((ok, gagal) => {
      const t = setTimeout(() => gagal(new Error("alat biometrik tidak menjawab")), batasBiometrikMs);
      p.then(ok, gagal).finally(() => clearTimeout(t));
    });

  async function picuBiometrik() {
    // Rantai serial: setiap kali mesin (kembali) masuk keadaan verifikasi, tepat satu permintaan ke alat.
    const s = sesi.keadaan();
    if ((s.tag !== "VERIFIKASI_WAJAH" && s.tag !== "VERIFIKASI_SIDIK_JARI") || !s.k.identitas) return;
    const nik = s.k.identitas.nik;
    // Galat atau alat diam melewati batas = tidak terbaca: mesin yang memutuskan coba lagi, sidik jari, atau petugas.
    const pm: PeristiwaMentah =
      s.tag === "VERIFIKASI_WAJAH"
        ? { tipe: "FRISTA", hasil: await dalamBatas(a.biometrik.wajah(nik, s.percobaan)).catch(() => ({ hasil: "wajah_tidak_terdeteksi", sebab: "tidak_diketahui" }) as const) }
        : { tipe: "SIDIK_JARI", hasil: await dalamBatas(a.biometrik.sidikJari(nik, s.percobaan)).catch(() => ({ hasil: "tidak_terbaca" }) as const) };
    await jalankan(pm);
  }

  async function dariPemindai(b: BacaanPemindai): Promise<PeristiwaMentah> {
    if (b.jenis === "gagal") return { tipe: GAGAL[b.sasaran] };
    if (sesi.keadaan().tag !== MENUNGGU[b.jenis]) return { tipe: GAGAL[b.jenis] }; // diabaikan + diaudit mesin
    switch (b.jenis) {
      case "dokumen":
        return { tipe: "DOKUMEN_TERBACA", dokumen: b.dokumen };
      case "kartu":
        try {
          const q = b.nomorKartu ? { nomorKartu: b.nomorKartu } : b.nik ? { nik: b.nik } : null;
          const p = q && (await klien.peserta(q));
          if (!p) return { tipe: "KARTU_GAGAL" };
          return { tipe: "KARTU_TERBACA", identitas: { ...p, sumber: b.sumber }, rm: await klien.statusRm(p.nik) };
        } catch {
          return { tipe: "KARTU_GAGAL" };
        }
      case "booking":
        try {
          const bk = await klien.booking(b.kodeBooking);
          const p = bk && (await klien.peserta({ nomorKartu: bk.nomorKartu }));
          if (!bk || !p) return { tipe: "KODE_BOOKING_GAGAL" };
          return { tipe: "KODE_BOOKING_TERBACA", identitas: { ...p, sumber: "kartu_jkn" }, booking: bk.booking, rm: await klien.statusRm(p.nik) };
        } catch {
          return { tipe: "KODE_BOOKING_GAGAL" };
        }
    }
  }

  a.stt.dengar((u) => void antre(() => jalankan(u)).catch(galat));
  a.pemindai.dengar((b) => void antre(async () => jalankan(await dariPemindai(b))).catch(galat));
  void antre(() => salurkan(sesi.awal)).catch(galat);

  return {
    layar: (p: PeristiwaLayar) => antre(() => jalankan(p)),
    petugas: (p: PeristiwaPetugas) => antre(() => jalankan(p)),
    /** Dipanggil server tiap detik: DIAM / WAKTU_HABIS dari runner. */
    tick: () =>
      antre(async () => {
        const r = await sesi.tick();
        if (r) await salurkan(r.efek);
      }),
    /** Selesai bila semua masukan yang sudah diterima tuntas diproses. */
    tenang: () => rantai.then(() => undefined),
  };
}
export type Pengemudi = ReturnType<typeof buatPengemudi>;
