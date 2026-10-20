import { test } from "node:test";
import assert from "node:assert/strict";
import { BATAS_JEV, GalatJev, JEV_MODEL, JEV_URL, buatKlienJev, klienJevDariEnv, type PertanyaanJev } from "../src/jev.js";
import { pahami } from "../src/pemahaman.js";
import { samarkan } from "../src/samarkan.js";
import { penilaiPalsu } from "./palsu.js";

const KUNCI = "kunci-rahasia-uji";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const BERHASIL = {
  model: "jev-latest",
  answers: { review: { type: "choice", choice: "accept", confidence: 0.82 }, aman: { type: "noul", noul: 0.1 } },
  usage: { input_tokens: 51, output_tokens: 0 },
};
const PERTANYAAN: Record<string, PertanyaanJev> = {
  review: { type: "choice", instructions: "Terima atau tinjau?", criteria: { accept: "terima", review: "tinjau" } },
  aman: { type: "noul", instructions: "Apakah aman?", criteria: { true: "aman", false: "tidak aman" } },
};

function klien(jawab: (init: RequestInit) => Promise<Response> | Response, batasWaktuMs = 1000) {
  const panggilan: { url: string; init: RequestInit }[] = [];
  const k = buatKlienJev({
    kunci: KUNCI,
    batasWaktuMs,
    fetch: async (url, init) => {
      panggilan.push({ url: String(url), init: init ?? {} });
      return jawab(init ?? {});
    },
  });
  return { k, panggilan };
}

test("jev: POST hanya ke gateway, Bearer dari kunci, model jev-latest persis, pertanyaan per ID; jawaban dibaca per ID", async () => {
  const { k, panggilan } = klien(() => json(BERHASIL));
  const r = await k.panggil({ teks: "ringkasan" }, PERTANYAAN);
  assert.equal(panggilan.length, 1);
  const [{ url, init }] = panggilan as [{ url: string; init: RequestInit }];
  assert.equal(url, "https://api.experientiallabs.ai/v1/systemone");
  assert.equal(url, JEV_URL);
  assert.equal(init.method, "POST");
  const h = init.headers as Record<string, string>;
  assert.equal(h.authorization, `Bearer ${KUNCI}`);
  assert.equal(h["idempotency-key"], undefined, "tanpa Idempotency-Key");
  const body = JSON.parse(String(init.body));
  assert.deepEqual(Object.keys(body).sort(), ["model", "questions", "state"]);
  assert.equal(body.model, JEV_MODEL);
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(body.questions, PERTANYAAN);
  assert.ok(init.signal, "batas waktu terpasang");
  assert.equal(r.answers.review?.type === "choice" && r.answers.review.choice, "accept");
  assert.deepEqual(r.usage, { input_tokens: 51, output_tokens: 0 });
});

test("jev: galat HTTP, transport, dan batas waktu dilempar; tepat satu permintaan (tanpa coba ulang); kunci tidak bocor", async () => {
  const kasus: [string, (init: RequestInit) => Promise<Response> | Response, RegExp][] = [
    ["503", () => json({ error: "service unavailable" }, 503), /HTTP 503/],
    ["transport", () => Promise.reject(new TypeError("fetch failed")), /transport: fetch failed/],
    [
      "batas waktu",
      (init) => new Promise((_ok, gagal) => init.signal?.addEventListener("abort", () => gagal(init.signal?.reason))),
      /batas waktu 30 ms habis/,
    ],
    ["skema", () => json({ model: "jev-latest", answers: {} }), /respons tidak sesuai skema/],
    ["jawaban hilang", () => json({ ...BERHASIL, answers: { review: BERHASIL.answers.review } }), /jawaban "aman" tidak ada/],
  ];
  for (const [nama, jawab, pola] of kasus) {
    const { k, panggilan } = klien(jawab, 30);
    await assert.rejects(k.panggil({}, PERTANYAAN), (e: unknown) => {
      assert.ok(e instanceof GalatJev, nama);
      assert.match(e.message, pola, nama);
      assert.ok(!e.message.includes(KUNCI), `${nama}: kunci bocor di pesan galat`);
      return true;
    });
    assert.equal(panggilan.length, 1, `${nama}: ada percobaan ulang`);
  }
});

test("jev: batas gateway (32 pertanyaan, 64 opsi per choice) ditolak sebelum permintaan dikirim", async () => {
  const { k, panggilan } = klien(() => json(BERHASIL));
  const banyak = Object.fromEntries(Array.from({ length: BATAS_JEV.pertanyaan + 1 }, (_, i) => [`q${i}`, PERTANYAAN.aman!]));
  await assert.rejects(k.panggil({}, banyak), /jumlah pertanyaan 33/);
  const opsi = Object.fromEntries(Array.from({ length: BATAS_JEV.opsiChoice + 1 }, (_, i) => [`o${i}`, "x"]));
  await assert.rejects(k.panggil({}, { besar: { type: "choice", instructions: "?", criteria: opsi } }), /opsi lebih dari 64/);
  assert.equal(panggilan.length, 0);
});

test("jev: tanpa EXPERIENTIAL_API_KEY klien tidak dibuat (Jev dilewati, kios jalan lewat Claude / kata kunci)", () => {
  assert.equal(klienJevDariEnv({}), null);
  assert.ok(klienJevDariEnv({ EXPERIENTIAL_API_KEY: "x" }));
});

test("penilai Jev: opsi di luar daftar ditolak lalu turun ke penilai berikutnya; jejak mencatat galat, bukan tebakan", async () => {
  const p = penilaiPalsu(() => ({ choice: "hapus_data", confidence: 0.99 }), () => ({ opsi: "kontrol", minta_petugas: false }));
  const { hasil, jejak } = await pahami("kunjungan", { pertanyaanKios: "Kontrol, atau bawa rujukan baru?", ujaran: samarkan("kontrol") }, p);
  assert.deepEqual(hasil, { jenis: "pasti", opsi: "kontrol", sumber: "claude" });
  assert.ok(jejak.jev && "galat" in jejak.jev && /opsi di luar daftar/.test(jejak.jev.galat));
});
