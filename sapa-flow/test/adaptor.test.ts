import { test } from "node:test";
import assert from "node:assert/strict";
import type { PeristiwaStt, Tts, VerifikasiBiometrik } from "../src/adaptor/antarmuka.js";
import { buatPengemudi } from "../src/adaptor/pengemudi.js";
import { buatSesi } from "../src/sesi.js";
import { buatAdaptorPalsu, type PanelDemo } from "../src/mock/adaptor-palsu.js";
import { OPSI_BAWAAN, jalankanDemo, type OpsiDemo } from "../src/mock/demo.js";
import { HARI_INI, KARTU_SITI } from "./palsu.js";

const demo = (o: Partial<OpsiDemo>) => jalankanDemo({ ...OPSI_BAWAAN, ...o }, HARI_INI);
const PEMAHAMAN_KATA_KUNCI = { jev: null, claude: null };

// ---------------------------------------------------------------- ujung ke ujung lewat panel demo + server mock
test("demo: alur bahagia Siti → verifikasi wajah → antrean dicetak, arahan poli", async () => {
  const r = await demo({});
  assert.deepEqual(r.jalur, ["TANYA_MODE", "SAPA_IZIN", "MINTA_KARTU", "VERIFIKASI_WAJAH", "TANYA_KUNJUNGAN", "SCAN_DOKUMEN", "KONFIRMASI_DATA", "MENUNGGU_PETUGAS_CEK", "SELESAI"]);
  assert.equal(r.hasil, "antrean_dicetak");
  assert.ok(r.layar.includes("[ANTREAN PD-001: ke poli]"));
  // Yang diucapkan Sapa tidak memuat deret angka (NIK, nomor kartu, nomor antrean).
  for (const b of r.layar.filter((b) => b.startsWith("Sapa:"))) assert.ok(!/\d{4,}|PD-/.test(b), b);
});

test("demo: wajah gagal → sidik jari lolos → antrean dicetak dengan verifikasi sidik_jari", async () => {
  const r = await demo({ wajah: "gagal", sidikjari: "lolos" });
  assert.ok(r.jalur.includes("VERIFIKASI_SIDIK_JARI"));
  assert.equal(r.hasil, "antrean_dicetak");
  assert.equal(r.akhir.k.verifikasi, "sidik_jari");
});

test("demo: wajah dan sidik jari tidak cocok → petugas (verifikasi_tidak_cocok), tidak ditolak", async () => {
  const r = await demo({ wajah: "tidakcocok", sidikjari: "tidakcocok" });
  assert.ok(r.layar.includes("[PANGGIL PETUGAS: verifikasi_tidak_cocok]"));
  assert.equal(r.hasil, "dilayani_petugas");
});

test("demo: Non BPJS dan Admission langsung ke petugas dengan alasan masing-masing", async () => {
  for (const [mode, alasan] of [["nonbpjs", "non_bpjs"], ["admission", "admission"]] as const) {
    const r = await demo({ mode });
    assert.deepEqual(r.jalur, ["TANYA_MODE", "MEMANGGIL_PETUGAS", "SELESAI"]);
    assert.ok(r.layar.includes(`[PANGGIL PETUGAS: ${alasan}]`), r.layar.join("\n"));
  }
});

test("demo: check-in kode booking lewat Antrean mock; tanpa booking → petugas", async () => {
  const r = await demo({ mode: "checkin" });
  assert.ok(r.jalur.includes("MINTA_KODE_BOOKING") && !r.jalur.includes("TANYA_KUNJUNGAN"));
  assert.equal(r.hasil, "antrean_dicetak");
  const tanpa = await demo({ mode: "checkin", peserta: "ahmad" });
  assert.ok(tanpa.layar.includes("[PANGGIL PETUGAS: kode_booking_tak_terbaca]"));
});

test("demo: RM belum ada (Ahmad) → arahan admisi; nonaktif (Rina) dan tak dikenal → petugas", async () => {
  assert.ok((await demo({ peserta: "ahmad" })).layar.includes("[ANTREAN PD-001: ke admisi]"));
  assert.ok((await demo({ peserta: "rina" })).layar.includes("[PANGGIL PETUGAS: peserta_tidak_aktif]"));
  assert.ok((await demo({ peserta: "takdikenal" })).layar.includes("[PANGGIL PETUGAS: kartu_tak_terbaca]"));
});

// ---------------------------------------------------------------- pengemudi tanpa server
function siapkan(biometrik: Partial<VerifikasiBiometrik> = {}, batasBiometrikMs?: number) {
  const panggilan: string[] = [];
  const klien = {
    peserta: async (q: { nik: string } | { nomorKartu: string }) => (panggilan.push("peserta"), "nomorKartu" in q ? KARTU_SITI : null),
    statusRm: async () => (panggilan.push("statusRm"), "ada" as const),
    booking: async () => (panggilan.push("booking"), null),
  };
  const palsu = buatAdaptorPalsu();
  const adaptor = { ...palsu.adaptor, biometrik: { ...palsu.adaptor.biometrik, ...biometrik } };
  const sesi = buatSesi(HARI_INI, PEMAHAMAN_KATA_KUNCI);
  const pengemudi = buatPengemudi({ sesi, adaptor, klien, ...(batasBiometrikMs ? { batasBiometrikMs } : {}) });
  return { ...palsu, sesi, pengemudi, panggilan };
}
const sampaiKartu = (panel: PanelDemo) => {
  panel.ucap("pakai BPJS");
  panel.ucap("iya boleh");
  panel.pindaiKartu({ nomorKartu: "0001234567890" });
};

test("pengemudi: bacaan kartu di luar MINTA_KARTU tidak memicu lookup VClaim/SIMRS (data minimal)", async () => {
  const { panel, pengemudi, sesi, panggilan } = siapkan();
  panel.pindaiKartu({ nomorKartu: "0001234567890" }); // masih TANYA_MODE
  await pengemudi.tenang();
  assert.equal(sesi.keadaan().tag, "TANYA_MODE");
  assert.deepEqual(panggilan, []);
});

test("pengemudi: galat alat biometrik = tak terbaca, berujung petugas (kios tidak macet)", async () => {
  const rusak = async (): Promise<never> => {
    throw new Error("alat putus");
  };
  const { panel, pengemudi, sesi } = siapkan({ wajah: rusak, sidikJari: rusak });
  sampaiKartu(panel);
  await pengemudi.tenang();
  const s = sesi.keadaan();
  assert.ok(s.tag === "MEMANGGIL_PETUGAS" && s.alasan === "verifikasi_tak_terbaca", s.tag);
});

test("pengemudi: alat biometrik menggantung dianggap tak terbaca setelah batas, jadi rantai (dan jam sesi) tidak macet", async () => {
  const gantung = () => new Promise<never>(() => {});
  const { panel, pengemudi, sesi } = siapkan({ wajah: gantung, sidikJari: gantung }, 5);
  sampaiKartu(panel);
  await pengemudi.tenang();
  assert.equal(sesi.keadaan().tag, "MEMANGGIL_PETUGAS");
});

// ---------------------------------------------------------------- tipe
test("tipe: adaptor hanya bisa memancarkan / menerima miliknya", () => {
  const tidakDipanggil = (tts: Tts, bio: VerifikasiBiometrik) => {
    // @ts-expect-error STT tidak bisa memancarkan hasil FRISTA
    const salah: PeristiwaStt = { tipe: "FRISTA", hasil: { hasil: "cocok" } };
    // @ts-expect-error TTS hanya menerima Giliran (Ucapan bermerek), bukan string bebas
    void tts.putar("Selamat pagi Siti Aminah");
    // @ts-expect-error NIK harus Pribadi<"NIK"> hasil validasi, bukan string biasa
    void bio.wajah("3273010101550001", 1);
    void salah;
  };
  void tidakDipanggil;
});
