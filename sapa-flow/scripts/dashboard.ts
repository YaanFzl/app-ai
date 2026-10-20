/**
 * `npm run dashboard`: dashboard petugas di http://localhost:8788 (PIN dari .env: DASHBOARD_PIN),
 * dengan kios demo yang menjalankan beberapa skenario berurutan. Audit (nama kolom + keputusan saja)
 * ditambahkan ke log/audit-petugas-YYYY-MM-DD.jsonl.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { hariIniJakarta } from "../src/mock/demo.js";
import { jalankanDashboardDemo } from "../src/mock/dashboard-demo.js";

try {
  process.loadEnvFile();
} catch {
  // .env opsional; variabel bisa datang dari shell.
}
const pin = process.env.DASHBOARD_PIN;
if (!pin) throw new Error("DASHBOARD_PIN belum diisi di .env");
const port = Number(process.env.DASHBOARD_PORT ?? 8788);
const hariIni = hariIniJakarta();
mkdirSync("log", { recursive: true });

const { dashboard, selesai } = await jalankanDashboardDemo({
  pin,
  hariIni,
  catatAudit: (c) => appendFileSync(`log/audit-petugas-${hariIni}.jsonl`, JSON.stringify(c) + "\n"),
});
dashboard.server.listen(port, () => console.log(`Dashboard petugas: http://localhost:${port}`));
const hasil = await selesai;
console.log(`Semua skenario selesai: ${hasil.map((h) => h.hasil).join(", ")}. Tekan Ctrl+C untuk berhenti.`);
