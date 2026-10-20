/**
 * `npm run kios`: layar kios demo di http://127.0.0.1:8789 (buka di Chrome `--kiosk`, potret 1080×1920).
 * Pasien mengetuk layar; kartu, biometrik, dokumen, dan petugas dipalsukan panel demo.
 * Opsi demo sama dengan `npm run demo` (mis. `-- --wajah=gagal --dokumen=ragu`).
 */
import { parseArgs } from "node:util";
import { OPSI_BAWAAN, hariIniJakarta, type OpsiDemo } from "../src/mock/demo.js";
import { jalankanKiosDemo } from "../src/mock/kios-demo.js";

const { values } = parseArgs({
  options: Object.fromEntries(Object.keys(OPSI_BAWAAN).map((k) => [k, { type: "string" as const }])),
});
const opsi = { ...OPSI_BAWAAN, ...values } as OpsiDemo;
const port = Number(process.env.KIOS_PORT ?? 8789);
const { layar } = await jalankanKiosDemo({ hariIni: hariIniJakarta(), opsi });
layar.server.listen(port, "127.0.0.1", () => console.log(`Layar kios: http://127.0.0.1:${port}`));
