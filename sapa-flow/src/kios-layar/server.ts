/**
 * Server layar kios: node:http + SSE (sementara; nanti web/ React + WS dengan kontrak yang sama).
 * Hanya melayani 127.0.0.1 (browser kios di mesin yang sama). Pesan ke layar lewat `KeKiosSchema`;
 * ketukan masuk lewat `DariKiosSchema` lalu diteruskan ke `tombol`.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DariKiosSchema, KeKiosSchema, type DariKios, type KeKios } from "./kontrak.js";
import { HALAMAN_KIOS } from "./halaman.js";

const ASET = new URL("../../page/sapa/", import.meta.url);
/** Hanya klip WebM dan frame PNG avatar; tidak ada path lain yang bisa dibaca. */
const POLA_ASET = /^\/sapa\/(sapa-[a-z-]+\.webm|frame-png\/[a-z-]+\/\d{3}\.png)$/;

async function bacaBody(req: IncomingMessage): Promise<string> {
  let teks = "";
  for await (const potong of req) {
    teks += potong;
    if (teks.length > 2_000) break;
  }
  return teks;
}

export function buatLayarKios(tombol: (d: DariKios) => void | Promise<void>) {
  const pendengar = new Set<ServerResponse>();
  /** Keadaan terakhir + pesan sesudahnya, untuk browser yang baru tersambung. Dibuang tiap ganti keadaan. */
  let keadaan: KeKios = { t: "keadaan", tag: "SIAGA", opsi: [] };
  let sejak: KeKios[] = [];

  const kirimSse = (res: ServerResponse, p: KeKios) => res.write(`data: ${JSON.stringify(p)}\n\n`);

  function kirim(masuk: KeKios) {
    const p = KeKiosSchema.parse(masuk);
    if (p.t === "keadaan") {
      if (keadaan.t === "keadaan" && keadaan.tag !== p.tag) sejak = [];
      keadaan = p;
    } else {
      sejak.push(p);
    }
    for (const res of pendengar) kirimSse(res, p);
  }

  const balas = (res: ServerResponse, status: number, jenis: string, isi: string | Buffer, simpan = false): void => {
    res.writeHead(status, { "content-type": jenis, "cache-control": simpan ? "max-age=3600" : "no-store" }).end(isi);
  };

  const server = createServer(async (req, res): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://kios");
    if (req.method === "GET" && url.pathname === "/") return balas(res, 200, "text/html; charset=utf-8", HALAMAN_KIOS);
    if (req.method === "GET" && POLA_ASET.test(url.pathname)) {
      try {
        const isi = await readFile(new URL(url.pathname.slice("/sapa/".length), ASET));
        return balas(res, 200, url.pathname.endsWith(".webm") ? "video/webm" : "image/png", isi, true);
      } catch {
        return balas(res, 404, "text/plain", "");
      }
    }
    if (req.method === "GET" && url.pathname === "/peristiwa") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": tersambung\n\n");
      for (const p of [keadaan, ...sejak]) kirimSse(res, p);
      pendengar.add(res);
      req.on("close", () => pendengar.delete(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/tombol") {
      let d: DariKios;
      try {
        d = DariKiosSchema.parse(JSON.parse(await bacaBody(req)));
      } catch {
        return balas(res, 400, "application/json", "{}");
      }
      await tombol(d);
      return balas(res, 204, "application/json", "");
    }
    balas(res, 404, "text/plain", "");
  });

  return { server, kirim };
}
