/**
 * Klien BACA SAJA untuk VClaim v2, WS Antrean RS (jadwal dokter, kode booking), dan SIMRS (status RM).
 * Biometrik (FRISTA / sidik jari) TIDAK di sini: batasnya adaptor `VerifikasiBiometrik`. Mock dan server asli dibedakan hanya oleh base URL di .env.
 * Hanya GET ke BPJS; POST hanya ke SIMRS supaya NIK tidak masuk URL.
 */
import { z } from "zod";
import type { Poli } from "../domain.js";
import { samarkan } from "../samarkan.js";
import { dekripsi, tandaTangan, type Kredensial } from "./kripto.js";
import {
  BookingAntreanSchema,
  JadwalDokterSchema,
  KODE_POLI,
  PesertaVclaimSchema,
  RencanaKontrolSchema,
  RujukanVclaimSchema,
  StatusRmSchema,
} from "./skema.js";

export interface KonfigKlien extends Kredensial {
  readonly vclaimUrl: string;
  readonly antreanUrl: string;
  readonly simrsUrl: string;
  readonly vclaimUserKey: string;
  readonly antreanUserKey: string;
  /** MOCK_PLAIN=1: `response` tidak dienkripsi (hanya untuk debugging dengan mock). */
  readonly plain: boolean;
  /** IZINKAN_LOOKUP_NIK: boleh mencari peserta lewat NIK (KTP). Saat false, alur tetap jalan dengan nomor kartu. */
  readonly izinkanLookupNik: boolean;
}

const bendera = (v: string | undefined, bawaan: boolean) => (v === undefined || v === "" ? bawaan : v === "1" || v === "true");

/** `izinkanNikBawaan`: klien bawaan false (data minimal), mock bawaan true. */
export function konfigDariEnv(env: NodeJS.ProcessEnv = process.env, izinkanNikBawaan = false): KonfigKlien {
  const wajib = (n: string) => {
    const v = env[n];
    if (!v) throw new Error(`${n} belum diisi di .env`);
    return v;
  };
  return {
    consId: wajib("BPJS_CONS_ID"),
    secretKey: wajib("BPJS_SECRET_KEY"),
    vclaimUserKey: wajib("VCLAIM_USER_KEY"),
    antreanUserKey: wajib("ANTREAN_USER_KEY"),
    vclaimUrl: wajib("VCLAIM_BASE_URL"),
    antreanUrl: wajib("ANTREAN_BASE_URL"),
    simrsUrl: wajib("SIMRS_BASE_URL"),
    plain: bendera(env.MOCK_PLAIN, false),
    izinkanLookupNik: bendera(env.IZINKAN_LOOKUP_NIK, izinkanNikBawaan),
  };
}

const Meta = z.object({ code: z.coerce.string(), message: z.string() });
/** VClaim memakai `metaData`, Antrean `metadata`. */
const Amplop = z.object({ metaData: Meta.optional(), metadata: Meta.optional(), response: z.unknown() });

const KODE_BPJS = Object.fromEntries(Object.entries(KODE_POLI).map(([kode, poli]) => [poli, kode])) as Partial<Record<Poli, string>>;
const tanggalJakarta = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const p = encodeURIComponent;

export function buatKlienBpjs(k: KonfigKlien, hariIni: () => string = tanggalJakarta) {
  /** `null` = tidak ditemukan (kode 201). Galat lain dilempar; pesannya disamarkan (bisa memuat NIK/nomor kartu). */
  async function getBpjs<T extends z.ZodTypeAny>(base: string, userKey: string, path: string, skema: T): Promise<z.output<T> | null> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${base}/${path}`, {
      headers: { "X-cons-id": k.consId, "X-timestamp": timestamp, "X-signature": tandaTangan(k, timestamp), user_key: userKey },
    });
    const amplop = Amplop.parse(await res.json());
    const meta = amplop.metaData ?? amplop.metadata;
    if (meta?.code === "201") return null;
    if (meta?.code !== "200") throw new Error(`${samarkan(path)}: ${meta?.code ?? res.status} ${samarkan(meta?.message ?? "")}`);
    return skema.parse(k.plain ? amplop.response : dekripsi(k, timestamp, z.string().parse(amplop.response)));
  }

  async function post<T extends z.ZodTypeAny>(base: string, path: string, body: unknown, skema: T): Promise<z.output<T>> {
    const res = await fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return skema.parse(await res.json());
  }

  const vclaim = <T extends z.ZodTypeAny>(path: string, skema: T) => getBpjs(k.vclaimUrl, k.vclaimUserKey, path, skema);
  const antrean = <T extends z.ZodTypeAny>(path: string, skema: T) => getBpjs(k.antreanUrl, k.antreanUserKey, path, skema);

  return {
    peserta(q: { nik: string } | { nomorKartu: string }) {
      if ("nik" in q) {
        if (!k.izinkanLookupNik) return Promise.resolve(null);
        return vclaim(`Peserta/nik/${p(q.nik)}/tglSEP/${hariIni()}`, PesertaVclaimSchema);
      }
      return vclaim(`Peserta/nokartu/${p(q.nomorKartu)}/tglSEP/${hariIni()}`, PesertaVclaimSchema);
    },
    rujukan: (noRujukan: string) => vclaim(`Rujukan/${p(noRujukan)}`, RujukanVclaimSchema),
    rujukanPeserta: (nomorKartu: string) => vclaim(`Rujukan/Peserta/${p(nomorKartu)}`, RujukanVclaimSchema),
    rencanaKontrol: (noSurat: string) => vclaim(`RencanaKontrol/noSuratKontrol/${p(noSurat)}`, RencanaKontrolSchema),
    async jadwal(poli: Poli, tanggal: string): Promise<{ jamPraktik: string } | null> {
      const kode = KODE_BPJS[poli];
      if (!kode) return null;
      const j = await antrean(`jadwaldokter/kodepoli/${kode}/tanggal/${p(tanggal)}`, JadwalDokterSchema);
      const praktik = j?.find((x) => !x.libur);
      return praktik ? { jamPraktik: praktik.jamPraktik } : null;
    },
    booking: (kodeBooking: string) => antrean(`antrean/pendaftaran/kodebooking/${p(kodeBooking)}`, BookingAntreanSchema),
    statusRm: (nik: string) => post(k.simrsUrl, "rm", { nik }, StatusRmSchema),
  };
}
export type KlienBpjs = ReturnType<typeof buatKlienBpjs>;
