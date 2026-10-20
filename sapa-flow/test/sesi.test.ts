import { test } from "node:test";
import assert from "node:assert/strict";
import { buatSesi, proses, WAKTU } from "../src/sesi.js";
import { mulai } from "../src/mesin.js";
import type { Efek } from "../src/mesin.js";
import { HARI_INI, KARTU_SITI, penilaiPalsu, rujukanUntuk } from "./palsu.js";

const JEV = { "pakai BPJS": "bpjs", "iya boleh": "ya", kontrol: "kontrol", betul: "ya" } as Record<string, string>;
const penilai = () =>
  penilaiPalsu((u) => ({ choice: JEV[u] ?? "tidak_jelas", confidence: 0.9 }), () => ({ opsi: "tidak_jelas", minta_petugas: false }));

/** Jam palsu: waktu hanya maju saat tes memajukannya. */
function jamPalsu() {
  let t = 1_000_000;
  return { jam: () => t, maju: (ms: number) => void (t += ms) };
}
const ucapan = (transkrip: string) => ({ tipe: "UCAPAN_PASIEN" as const, transkrip });

test("runner: diam satu giliran → pertanyaan diulang sekali; diam lagi → petugas", async () => {
  const { jam, maju } = jamPalsu();
  const sesi = buatSesi(HARI_INI, penilai(), jam);

  maju(WAKTU.giliranMs - 1);
  assert.equal(sesi.tick(), null, "belum lewat batas giliran");

  maju(1);
  const ulang = await sesi.tick();
  assert.equal(sesi.keadaan().tag, "TANYA_MODE");
  assert.ok(ulang?.efek.some((e) => e.efek === "bicara" && e.giliran.subtitle === "BPJS, kode booking, atau bukan BPJS?"));

  maju(WAKTU.giliranMs);
  await sesi.tick();
  const s = sesi.keadaan();
  assert.equal(s.tag === "MEMANGGIL_PETUGAS" && s.alasan, "diam_terlalu_lama");
  maju(WAKTU.sesiMs);
  assert.equal(sesi.tick(), null, "jam berhenti setelah petugas dipanggil");
});

test("runner: menjawab mereset jam giliran", async () => {
  const { jam, maju } = jamPalsu();
  const sesi = buatSesi(HARI_INI, penilai(), jam);
  maju(WAKTU.giliranMs - 1_000);
  await sesi.kirim(ucapan("pakai BPJS"));
  maju(WAKTU.giliranMs - 1_000);
  assert.equal(sesi.tick(), null);
  assert.equal(sesi.keadaan().tag, "SAPA_IZIN");
});

test("runner: sesi melewati batas → WAKTU_HABIS → petugas", async () => {
  const { jam, maju } = jamPalsu();
  const sesi = buatSesi(HARI_INI, penilai(), jam);
  // Pasien terus menjawab (jam giliran tak pernah habis) tapi sesi berjalan lama.
  for (const u of ["pakai BPJS", "iya boleh"]) {
    maju(WAKTU.giliranMs - 1);
    await sesi.kirim(ucapan(u));
  }
  maju(WAKTU.sesiMs);
  await sesi.tick();
  const s = sesi.keadaan();
  assert.equal(s.tag === "MEMANGGIL_PETUGAS" && s.alasan, "waktu_habis");
});

test("runner: durasi sesi dicatat di audit saat SELESAI", async () => {
  const { jam, maju } = jamPalsu();
  const sesi = buatSesi(HARI_INI, penilai(), jam);
  const semua: Efek[] = [];
  const kirim = async (pm: Parameters<typeof sesi.kirim>[0]) => {
    maju(10_000);
    semua.push(...(await sesi.kirim(pm)).efek);
  };
  await kirim(ucapan("pakai BPJS"));
  await kirim(ucapan("iya boleh"));
  await kirim({ tipe: "KARTU_TERBACA", identitas: KARTU_SITI, rm: "ada" });
  await kirim({ tipe: "FRISTA", hasil: { hasil: "cocok" } });
  await kirim(ucapan("kontrol"));
  await kirim({ tipe: "DOKUMEN_TERBACA", dokumen: { ...rujukanUntuk(KARTU_SITI), jenis: "surat_kontrol" } });
  await kirim(ucapan("betul"));
  await kirim({ tipe: "PETUGAS_SETUJU", nomorAntrean: "PD-017" });
  assert.equal(sesi.keadaan().tag, "SELESAI");
  const durasi = semua.flatMap((e) => (e.efek === "audit" && e.catatan.jenis === "durasi_sesi" ? [e.catatan.ms] : []));
  assert.deepEqual(durasi, [80_000]);
});

test("runner: peristiwa diproses berurutan; tick tidak menyela jawaban yang sedang dinilai", async () => {
  const { jam, maju } = jamPalsu();
  const sesi = buatSesi(HARI_INI, penilai(), jam);
  maju(WAKTU.giliranMs);
  const jawab = sesi.kirim(ucapan("pakai BPJS"));
  assert.equal(sesi.tick(), null, "sedang menilai jawaban");
  await jawab;
  assert.equal(sesi.keadaan().tag, "SAPA_IZIN");
});

test("sentuh: opsi milik topik → JAWABAN pasti sumber \"sentuh\" tanpa AI; opsi asing / keadaan tanpa topik → diabaikan", async () => {
  const p = penilai();
  const s0 = mulai(HARI_INI).berikut; // TANYA_MODE
  const ok = await proses(s0, { tipe: "SENTUH_OPSI", opsi: "bpjs" }, p);
  assert.equal(ok.berikut.tag, "SAPA_IZIN");
  assert.ok(ok.efek.some((e) => e.efek === "audit" && e.catatan.jenis === "pemahaman" && e.catatan.sumber === "sentuh"));
  assert.equal(p.reqJev.length + p.reqClaude.length, 0, "ketukan tidak boleh memanggil AI");

  const diabaikan = (efek: readonly Efek[]) => efek.some((e) => e.efek === "audit" && e.catatan.jenis === "diabaikan");
  const asing = await proses(s0, { tipe: "SENTUH_OPSI", opsi: "ya" }, p); // "ya" bukan opsi topik mode
  assert.equal(asing.berikut, s0);
  assert.ok(diabaikan(asing.efek));

  const kartu = (await proses(ok.berikut, { tipe: "SENTUH_OPSI", opsi: "ya" }, p)).berikut; // izin → MINTA_KARTU
  assert.equal(kartu.tag, "MINTA_KARTU");
  const tanpaTopik = await proses(kartu, { tipe: "SENTUH_OPSI", opsi: "ya" }, p);
  assert.equal(tanpaTopik.berikut, kartu);
  assert.ok(diabaikan(tanpaTopik.efek));
});
