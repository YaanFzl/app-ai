/**
 * Server mock yang meniru bentuk path VClaim v2.0, WS Antrean RS, dan SIMRS (format kita).
 * Biometrik tidak lewat HTTP: dipalsukan di adaptor (`adaptor-palsu.ts`).
 * HANYA untuk test/ dan demo; kode kios tidak boleh mengimpor folder ini (test/larangan.test.ts).
 * Tidak ada endpoint tulis: BPJS hanya GET; POST hanya untuk SIMRS (NIK di body, bukan URL).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { enkripsi, tandaTangan } from "../bpjs/kripto.js";
import type { KonfigKlien } from "../bpjs/klien.js";
import { samarkan } from "../samarkan.js";
import { buatDataMock } from "./data.js";

export type OpsiMock = Pick<KonfigKlien, "consId" | "secretKey" | "vclaimUserKey" | "antreanUserKey" | "plain" | "izinkanLookupNik"> & {
  readonly hariIni: string;
  /** Baris log; path sudah disamarkan (NIK / nomor kartu tidak pernah tercatat utuh). */
  readonly catat?: (baris: string) => void;
};

const kirim = (res: ServerResponse, status: number, isi: unknown) => {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(isi));
};

async function bacaBody(req: IncomingMessage): Promise<{ nik?: unknown }> {
  let teks = "";
  for await (const potong of req) teks += potong;
  try {
    return JSON.parse(teks) ?? {};
  } catch {
    return {};
  }
}

export function buatServerMock(o: OpsiMock) {
  const data = buatDataMock(o.hariIni);
  const catat = o.catat ?? ((b: string) => console.log(b));

  /** Rute BPJS: `undefined` = path tak dikenal (404), `null` = tidak ditemukan (kode 201). */
  function ruteVclaim(path: string): unknown {
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^Peserta\/nokartu\/([^/]+)\/tglSEP\/[^/]+$/))) {
      const x = data.peserta.find((x) => x.noKartu === m![1]);
      return x ? { peserta: x } : null;
    }
    if ((m = path.match(/^Peserta\/nik\/([^/]+)\/tglSEP\/[^/]+$/))) {
      if (!o.izinkanLookupNik) return undefined;
      const x = data.peserta.find((x) => x.nik === m![1]);
      return x ? { peserta: x } : null;
    }
    if ((m = path.match(/^Rujukan\/Peserta\/([^/]+)$/))) {
      const x = data.rujukan.find((r) => r.peserta.noKartu === m![1]);
      return x ? { rujukan: x } : null;
    }
    if ((m = path.match(/^Rujukan\/([^/]+)$/))) {
      const x = data.rujukan.find((r) => r.noKunjungan === m![1]);
      return x ? { rujukan: x } : null;
    }
    if ((m = path.match(/^RencanaKontrol\/noSuratKontrol\/([^/]+)$/))) {
      return data.rencanaKontrol.find((r) => r.noSuratKontrol === m![1]) ?? null;
    }
    return undefined;
  }

  function ruteAntrean(path: string): unknown {
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^jadwaldokter\/kodepoli\/([^/]+)\/tanggal\/[^/]+$/))) {
      const x = data.jadwal.filter((j) => j.kodepoli === m![1]);
      return x.length ? x : null;
    }
    if ((m = path.match(/^antrean\/pendaftaran\/kodebooking\/([^/]+)$/))) {
      const x = data.booking.filter((b) => b.kodebooking === m![1]);
      return x.length ? x : null;
    }
    return undefined;
  }

  function layaniBpjs(req: IncomingMessage, res: ServerResponse, layanan: "vclaim" | "antrean", path: string) {
    const amplop = (code: number, message: string, response: unknown) =>
      layanan === "vclaim" ? { metaData: { code: String(code), message }, response } : { metadata: { code, message }, response };
    const ts = String(req.headers["x-timestamp"] ?? "");
    const userKey = layanan === "vclaim" ? o.vclaimUserKey : o.antreanUserKey;
    // ponytail: umur timestamp tidak dicek; tambahkan jendela waktu bila mock dipakai uji replay.
    if (req.headers["x-cons-id"] !== o.consId || req.headers["user_key"] !== userKey || req.headers["x-signature"] !== tandaTangan(o, ts)) {
      return kirim(res, 401, amplop(401, "Signature tidak valid", null));
    }
    if (req.method !== "GET") return kirim(res, 405, amplop(405, "Hanya baca", null));
    const isi = layanan === "vclaim" ? ruteVclaim(path) : ruteAntrean(path);
    if (isi === undefined) return kirim(res, 404, amplop(404, "Path tidak dikenal", null));
    if (isi === null) return kirim(res, 200, amplop(201, "Data tidak ditemukan", null));
    kirim(res, 200, amplop(200, "OK", o.plain ? isi : enkripsi(o, ts, isi)));
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const [, layanan = "", ...sisa] = url.pathname.split("/");
    const path = sisa.map(decodeURIComponent).join("/");
    catat(`${req.method} /${layanan}/${samarkan(path)}`);

    if (layanan === "vclaim-rest") return layaniBpjs(req, res, "vclaim", path);
    if (layanan === "antreanrs") return layaniBpjs(req, res, "antrean", path);
    if (req.method !== "POST") return kirim(res, 405, { pesan: "Hanya POST" });
    const body = await bacaBody(req);
    if (layanan === "simrs" && path === "rm") return kirim(res, 200, { adaRm: data.rmAda.has(String(body.nik ?? "")) });
    kirim(res, 404, { pesan: "Path tidak dikenal" });
  });
}
