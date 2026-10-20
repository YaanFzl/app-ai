/** Entry point mock: `npm run mock`. Membaca .env yang sama dengan klien. */
import { konfigDariEnv } from "../bpjs/klien.js";
import { buatServerMock } from "./server.js";

try {
  process.loadEnvFile();
} catch {
  // .env opsional; variabel bisa datang dari shell.
}
const k = konfigDariEnv(process.env, true);
const port = Number(process.env.MOCK_PORT ?? 8787);
const hariIni = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
buatServerMock({ ...k, hariIni }).listen(port, () => {
  console.log(`Mock BPJS di http://localhost:${port} (enkripsi ${k.plain ? "MATI" : "nyala"}, lookup NIK ${k.izinkanLookupNik ? "boleh" : "tidak"})`);
});
