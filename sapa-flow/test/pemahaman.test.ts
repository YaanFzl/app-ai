import { test } from "node:test";
import assert from "node:assert/strict";
import { AMBANG, MODEL_CLAUDE, nilaiKataKunci, pahami } from "../src/pemahaman.js";
import { samarkan } from "../src/samarkan.js";
import { penilaiPalsu } from "./palsu.js";

const m = (u: string) => ({ pertanyaanKios: "Kontrol, atau bawa rujukan baru?", ujaran: samarkan(u) });

test("Jev: payload memakai Choice + Noul, opsi tidak_jelas selalu ada, gateway /v1/systemone, model jev-latest", async () => {
  const p = penilaiPalsu(() => ({ choice: "kontrol", confidence: 0.9 }), () => "galat");
  const { hasil } = await pahami("kunjungan", m("kontrol"), p);
  assert.deepEqual(hasil, { jenis: "pasti", opsi: "kontrol", sumber: "jev" });
  const req = p.reqJev[0];
  assert.equal(req.url, "https://api.experientiallabs.ai/v1/systemone");
  assert.equal(req.body.model, "jev-latest");
  assert.equal(req.body.questions.jawaban.type, "choice");
  assert.deepEqual(Object.keys(req.body.questions.jawaban.criteria).sort(), ["kontrol", "lainnya", "rujukan_baru", "tidak_jelas"]);
  assert.equal(req.body.questions.minta_petugas.type, "noul");
  assert.equal(p.reqClaude.length, 0, "Claude tidak dipanggil saat Jev yakin");
});

test("SDK Anthropic: strict tool, tool_choice paksa, enum = opsi + tidak_jelas, model Haiku 5.5", async () => {
  const p = penilaiPalsu(() => ({ choice: "rujukan_baru", confidence: 0.45 }), () => ({ opsi: "rujukan_baru", minta_petugas: false }));
  const { hasil } = await pahami("kunjungan", m("dari puskesmas"), p);
  assert.deepEqual(hasil, { jenis: "pasti", opsi: "rujukan_baru", sumber: "jev+claude" });
  const b = p.reqClaude[0].body;
  assert.equal(b.model, MODEL_CLAUDE);
  assert.equal(b.tools[0].strict, true);
  assert.equal(b.tools[0].input_schema.additionalProperties, false);
  assert.deepEqual(b.tools[0].input_schema.properties.opsi.enum, ["kontrol", "rujukan_baru", "lainnya", "tidak_jelas"]);
  assert.deepEqual(b.tool_choice, { type: "tool", name: "pilih_opsi", disable_parallel_tool_use: true });
  assert.deepEqual(b.thinking, { type: "disabled" });
});

test("pita keyakinan: ≥0.6 terima, 0.3–0.6 minta Claude, <0.3 tanya ulang", async () => {
  const kasus: [number, string, string][] = [
    [0.61, "kontrol", "pasti"],
    [0.59, "lainnya", "tanya_ulang"], // Claude tidak setuju → beda_pendapat
    [0.29, "kontrol", "tanya_ulang"],
  ];
  for (const [yakin, claudeBilang, harap] of kasus) {
    const p = penilaiPalsu(() => ({ choice: "kontrol", confidence: yakin }), () => ({ opsi: claudeBilang, minta_petugas: false }));
    const { hasil } = await pahami("kunjungan", m("x"), p);
    assert.equal(hasil.jenis, harap, `keyakinan ${yakin}`);
  }
  assert.equal(AMBANG.terimaLangsung, 0.6);
});

test("Claude mengembalikan opsi di luar daftar → ditolak validasi, kios bertanya ulang", async () => {
  const p = penilaiPalsu(() => ({ choice: "kontrol", confidence: 0.4 }), () => ({ opsi: "igd_sekarang", minta_petugas: false }));
  const { hasil, jejak } = await pahami("kunjungan", m("x"), p);
  assert.deepEqual(hasil, { jenis: "tanya_ulang", sebab: "ragu" });
  assert.ok(jejak.claude && "galat" in jejak.claude);
});

test("Claude menormalkan kapitalisasi enum (docs: kapitalisasi tidak dijamin)", async () => {
  const p = penilaiPalsu(() => "galat", () => ({ opsi: "KONTROL", minta_petugas: false }));
  const { hasil } = await pahami("kunjungan", m("x"), p);
  assert.deepEqual(hasil, { jenis: "pasti", opsi: "kontrol", sumber: "claude" });
});

test("kata kunci: satu opsi kena = yakin; dua opsi kena = tidak jelas (aman)", () => {
  assert.equal(nilaiKataKunci("izin", samarkan("nggih, monggo")).opsi, "ya");
  assert.equal(nilaiKataKunci("izin", samarkan("nggak apa-apa, silakan")).opsi, "tidak_jelas");
  assert.equal(nilaiKataKunci("kunjungan", samarkan("Rujukan dari Puskesmas")).opsi, "rujukan_baru");
  assert.equal(nilaiKataKunci("kunjungan", samarkan("panggilkan petugas")).mintaPetugas, true);
});

test("kata kunci mode konsol: satu ujaran per opsi; 'mobile jkn' tidak bentrok dengan bpjs", () => {
  assert.equal(nilaiKataKunci("mode", samarkan("pakai BPJS, Nak")).opsi, "bpjs");
  assert.equal(nilaiKataKunci("mode", samarkan("sudah daftar di Mobile JKN")).opsi, "checkin");
  assert.equal(nilaiKataKunci("mode", samarkan("umum saja")).opsi, "non_bpjs");
  assert.equal(nilaiKataKunci("mode", samarkan("bapak saya mau opname")).opsi, "admission");
});

test("samarkan: angka, spasi berlebih, panjang", () => {
  assert.equal(samarkan("NIK  3273 0101 0155 0001 ya"), "NIK [angka] ya");
  assert.equal(samarkan("x".repeat(500)).length, 240);
});

test("darurat: Noul Jev ≥ 0.3 menang atas opsi yang yakin; kata kunci juga menangkap saat AI putus", async () => {
  const p = penilaiPalsu(() => ({ choice: "kontrol", confidence: 0.95, darurat: 0.35 }), () => "galat");
  assert.deepEqual((await pahami("kunjungan", m("kontrol, dada saya sakit"), p)).hasil, { jenis: "darurat" });
  assert.equal(p.reqJev[0].body.questions.darurat.type, "noul");
  const putus = penilaiPalsu(() => "galat", () => "galat");
  assert.deepEqual((await pahami("kunjungan", m("dada saya sakit sekali sekarang"), putus)).hasil, { jenis: "darurat" });
});
