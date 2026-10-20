import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buatKlienBpjs, type KonfigKlien } from "../src/bpjs/klien.js";
import { buatServerMock, type OpsiMock } from "../src/mock/server.js";
import { BOOKING_SITI, HARI_INI, KARTU_SITI } from "./palsu.js";

const KRED = { consId: "uji-cons", secretKey: "uji-secret", vclaimUserKey: "uji-vclaim", antreanUserKey: "uji-antrean" };
const SITI = { nik: KARTU_SITI.nik, noKartu: "0001234567890" };
const RINA = "0001234567892";
const JOKO = "0001234567895";
const WATI = { noKartu: "0001234567896", kodeBooking: "BK2026101200018" };

const server: ReturnType<typeof buatServerMock>[] = [];
after(() => server.forEach((s) => s.close()));

async function siapkan(mock: Partial<OpsiMock> = {}, klien: Partial<KonfigKlien> = {}) {
  const log: string[] = [];
  const s = buatServerMock({ ...KRED, plain: false, izinkanLookupNik: true, hariIni: HARI_INI, catat: (b) => log.push(b), ...mock });
  server.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const k: KonfigKlien = {
    ...KRED,
    vclaimUrl: `${base}/vclaim-rest`,
    antreanUrl: `${base}/antreanrs`,
    simrsUrl: `${base}/simrs`,
    plain: false,
    izinkanLookupNik: true,
    ...klien,
  };
  return { klien: buatKlienBpjs(k, () => HARI_INI), log, base };
}

const { sumber: _sumber, ...pesertaSiti } = KARTU_SITI;

test("mock: peserta aktif (Siti) lengkap: peserta, booking, jadwal, RM, rujukan, rencana kontrol", async () => {
  const { klien } = await siapkan();
  assert.deepEqual(await klien.peserta({ nomorKartu: SITI.noKartu }), pesertaSiti);
  assert.deepEqual(await klien.booking(BOOKING_SITI.kodeBooking), { nomorKartu: SITI.noKartu, booking: BOOKING_SITI });
  assert.deepEqual(await klien.jadwal("penyakit_dalam", HARI_INI), { jamPraktik: "08:00-12:00" });
  assert.equal(await klien.statusRm(SITI.nik), "ada");
  assert.deepEqual(await klien.rujukan("0301U0011026B000001"), { poli: "penyakit_dalam", berlakuSampai: "2026-12-11" });
  assert.deepEqual(await klien.rencanaKontrol("0301R0011026K000001"), { poli: "penyakit_dalam", tanggal: HARI_INI });
});

test("mock: nonaktif karena tunggakan → tidak_aktif (alasan tunggakan dibuang skema); tidak ditemukan → null", async () => {
  const { klien } = await siapkan();
  const rina = await klien.peserta({ nomorKartu: RINA });
  assert.equal(rina?.statusPeserta, "tidak_aktif");
  assert.ok(!JSON.stringify(rina).toLowerCase().includes("tunggakan"));
  assert.equal(await klien.peserta({ nomorKartu: "0009999999999" }), null);
  assert.equal(await klien.booking("TIDAKADA"), null);
});

test("mock: rujukan kedaluwarsa (Joko) dan poli berbeda booking vs rujukan (Wati)", async () => {
  const { klien } = await siapkan();
  const joko = await klien.rujukanPeserta(JOKO);
  assert.ok(joko && joko.berlakuSampai < HARI_INI, `rujukan Joko masih berlaku: ${joko?.berlakuSampai}`);
  const booking = await klien.booking(WATI.kodeBooking);
  const rujukan = await klien.rujukanPeserta(WATI.noKartu);
  assert.equal(booking?.booking.poli, "penyakit_dalam");
  assert.equal(rujukan?.poli, "jantung");
});

test("enkripsi bawaan: response berupa sandi; MOCK_PLAIN=1 di kedua sisi tetap jalan", async () => {
  const { base } = await siapkan();
  const mentah = await fetch(`${base}/vclaim-rest/Rujukan/0301U0011026B000001`, {
    headers: { "X-cons-id": KRED.consId, "X-timestamp": "1", "X-signature": (await import("../src/bpjs/kripto.js")).tandaTangan(KRED, "1"), user_key: KRED.vclaimUserKey },
  }).then((r) => r.json());
  assert.equal(typeof mentah.response, "string");
  const { klien } = await siapkan({ plain: true }, { plain: true });
  assert.deepEqual(await klien.peserta({ nomorKartu: SITI.noKartu }), pesertaSiti);
});

test("tanda tangan salah → galat 401, bukan data", async () => {
  const { klien } = await siapkan({}, { secretKey: "salah" });
  await assert.rejects(klien.peserta({ nomorKartu: SITI.noKartu }), /401/);
});

test("lookup NIK: boleh bila diizinkan; saat false tidak ada request, alur tetap jalan lewat nomor kartu; NIK tersamar di log", async () => {
  const boleh = await siapkan();
  assert.deepEqual(await boleh.klien.peserta({ nik: SITI.nik }), pesertaSiti);

  const tidak = await siapkan({}, { izinkanLookupNik: false });
  assert.equal(await tidak.klien.peserta({ nik: SITI.nik }), null);
  assert.equal(tidak.log.length, 0, "klien tetap mengirim request NIK");
  assert.deepEqual(await tidak.klien.peserta({ nomorKartu: SITI.noKartu }), pesertaSiti);

  const mockTolak = await siapkan({ izinkanLookupNik: false });
  await assert.rejects(mockTolak.klien.peserta({ nik: SITI.nik }), /404/);

  for (const baris of [...boleh.log, ...tidak.log, ...mockTolak.log]) assert.ok(!/\d{4,}/.test(baris), `log memuat angka: ${baris}`);
});
