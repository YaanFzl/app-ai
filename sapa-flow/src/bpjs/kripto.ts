/**
 * Tanda tangan header dan enkripsi `response` VClaim v2 / WS Antrean RS.
 * SATU-SATUNYA tempat logika kripto; klien (dekripsi) dan mock (enkripsi) sama-sama memakai modul ini.
 *
 * PERINGATAN: skema di bawah berasal dari implementasi komunitas (pustaka VClaim open source),
 * BELUM diverifikasi terhadap katalog resmi BPJS. Cocokkan sebelum dipakai ke server asli.
 *   - X-signature = base64(HMAC-SHA256(`${consId}&${timestamp}`, secretKey)), timestamp = detik epoch UTC.
 *   - response    = base64(AES-256-CBC(LZString.compressToEncodedURIComponent(json))),
 *                   kunci = sha256(consId + secretKey + timestamp), IV = 16 byte pertama kunci.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import lz from "lz-string";

export interface Kredensial {
  readonly consId: string;
  readonly secretKey: string;
}

export const tandaTangan = (k: Kredensial, timestamp: string): string =>
  createHmac("sha256", k.secretKey).update(`${k.consId}&${timestamp}`).digest("base64");

function kunci(k: Kredensial, timestamp: string) {
  const key = createHash("sha256").update(k.consId + k.secretKey + timestamp).digest();
  return { key, iv: key.subarray(0, 16) };
}

export function enkripsi(k: Kredensial, timestamp: string, data: unknown): string {
  const { key, iv } = kunci(k, timestamp);
  const c = createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([c.update(lz.compressToEncodedURIComponent(JSON.stringify(data)), "utf8"), c.final()]).toString("base64");
}

export function dekripsi(k: Kredensial, timestamp: string, sandi: string): unknown {
  const { key, iv } = kunci(k, timestamp);
  const d = createDecipheriv("aes-256-cbc", key, iv);
  const terkompres = Buffer.concat([d.update(sandi, "base64"), d.final()]).toString("utf8");
  return JSON.parse(lz.decompressFromEncodedURIComponent(terkompres));
}
