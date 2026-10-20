import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_WAKTU, SKENARIO_DURASI, biayaKeadaan, simulasiDurasi } from "../eval/durasi.js";
import { mulai } from "../src/mesin.js";
import { HARI_INI } from "./palsu.js";

test("durasi eval: jam simulasi lewat runner asli; deterministik; waktu petugas ikut terhitung", async () => {
  const pilih = SKENARIO_DURASI.filter((s) => ["BPJS kontrol, RM ada", "Non BPJS → petugas"].includes(s.nama));
  const [a, b] = await simulasiDurasi(HARI_INI, pilih);
  const [a2] = await simulasiDurasi(HARI_INI, pilih.slice(0, 1));
  assert.ok(a && b && a2);
  assert.equal(a.hasil, "antrean_dicetak");
  assert.equal(a.detik, a2.detik, "tidak deterministik");
  // Non BPJS: tanya mode → petugas datang → melayani → selesai. Durasi = jumlah biaya ketiga keadaan itu.
  const awal = biayaKeadaan(mulai(HARI_INI).berikut);
  assert.equal(b.hasil, "dilayani_petugas");
  assert.ok(Math.abs(b.detik! - (awal + b.detikPetugas)) < 0.01, `${b.detik} ≠ ${awal} + ${b.detikPetugas}`);
  assert.ok(b.detikPetugas >= MODEL_WAKTU.petugasDatang + MODEL_WAKTU.petugasMelayani);
});
