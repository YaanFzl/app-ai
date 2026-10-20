/**
 * Demo CLI: `npm run demo -- --wajah=gagal --sidikjari=lolos --mode=nonbpjs`
 * Opsi (semua opsional; bawaan = alur bahagia Siti):
 *   --mode=bpjs|checkin|nonbpjs|admission   --peserta=siti|ahmad|rina|budi|dewi|joko|wati|takdikenal
 *   --kartu=terbaca|gagal   --wajah=lolos|gagal|tidakcocok   --sidikjari=lolos|gagal|tidakcocok
 *   --kunjungan=kontrol|rujukan   --dokumen=cocok|ragu   --konfirmasi=ya|tidak   --petugas=setuju|ambilalih
 */
import { parseArgs } from "node:util";
import { OPSI_BAWAAN, PESERTA, jalankanDemo, type OpsiDemo } from "../src/mock/demo.js";

const PILIHAN: { [K in keyof OpsiDemo]: readonly OpsiDemo[K][] } = {
  mode: ["bpjs", "checkin", "nonbpjs", "admission"],
  peserta: Object.keys(PESERTA) as (keyof typeof PESERTA)[],
  kartu: ["terbaca", "gagal"],
  wajah: ["lolos", "gagal", "tidakcocok"],
  sidikjari: ["lolos", "gagal", "tidakcocok"],
  kunjungan: ["kontrol", "rujukan"],
  dokumen: ["cocok", "ragu"],
  konfirmasi: ["ya", "tidak"],
  petugas: ["setuju", "ambilalih"],
};

const { values } = parseArgs({
  options: Object.fromEntries(Object.keys(PILIHAN).map((k) => [k, { type: "string" as const }])),
});
const opsi: Record<string, string> = { ...OPSI_BAWAAN };
for (const [k, v] of Object.entries(values)) {
  const boleh = PILIHAN[k as keyof OpsiDemo] as readonly string[];
  if (typeof v !== "string" || !boleh.includes(v)) {
    console.error(`--${k}=${String(v)} tidak dikenal. Pilihan: ${boleh.join(" | ")}`);
    process.exit(2);
  }
  opsi[k] = v;
}

const r = await jalankanDemo(opsi as unknown as OpsiDemo);
console.log(`Opsi: ${Object.entries(opsi).map(([k, v]) => `${k}=${v}`).join(" ")}\n`);
for (const baris of r.layar) console.log(baris);
console.log(`\nJalur : ${r.jalur.join(" → ")}`);
console.log(`Hasil : ${r.hasil ?? `belum selesai (${r.akhir.tag})`}${r.akhir.k.verifikasi ? `, verifikasi ${r.akhir.k.verifikasi}` : ""}`);
