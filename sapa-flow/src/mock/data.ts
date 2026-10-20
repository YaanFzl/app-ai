/**
 * Data dummy buatan tim, dalam bentuk respons mentah VClaim / Antrean. BUKAN data peserta riil.
 * NIK dan nomor kartu dikarang; tidak ada diagnosa, riwayat pelayanan, rincian iuran, atau foto.
 * Tanggal relatif terhadap `hariIni` supaya skenario kedaluwarsa tetap kedaluwarsa.
 */
const geserHari = (tgl: string, hari: number) => {
  const d = new Date(`${tgl}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
};

const AKTIF = { kode: "0", keterangan: "AKTIF" };

const peserta = (noKartu: string, nik: string, nama: string, tglLahir: string, sex: "L" | "P", statusPeserta = AKTIF) => ({
  noKartu,
  nik,
  nama,
  tglLahir,
  sex,
  statusPeserta,
  hakKelas: { kode: "3", keterangan: "KELAS III" },
  jenisPeserta: { kode: "14", keterangan: "PEKERJA MANDIRI" },
});

export function buatDataMock(hariIni: string) {
  const rujukan = (noKunjungan: string, noKartu: string, kodePoli: string, umurHari: number) => ({
    noKunjungan,
    tglKunjungan: geserHari(hariIni, -umurHari),
    poliRujukan: { kode: kodePoli, nama: kodePoli },
    provPerujuk: { kode: "0301U001", nama: "PUSKESMAS FIKTIF" },
    peserta: { noKartu },
  });
  const booking = (kodebooking: string, noantrean: string, nokapst: string, nik: string) => ({
    kodebooking,
    tanggal: hariIni,
    kodepoli: "INT",
    kodedokter: 101,
    jampraktek: "08:00-12:00",
    nik,
    nokapst,
    noantrean,
    jeniskunjungan: 3,
    status: "Belum dilayani",
  });

  return {
    peserta: [
      /** Aktif, RM ada, rujukan INT berlaku, booking INT hari ini. */
      peserta("0001234567890", "3273010101550001", "Siti Aminah", "1955-01-01", "P"),
      /** Aktif, RM belum ada (diarahkan ke admisi). */
      peserta("0001234567891", "3273010202480002", "Ahmad Sujono", "1948-02-02", "L"),
      /** Nonaktif karena tunggakan. TODO verifikasi kode statusPeserta resmi; kios hanya melihat "tidak_aktif". */
      peserta("0001234567892", "3273014404600003", "Rina Marlina", "1960-04-04", "P", { kode: "1", keterangan: "TIDAK AKTIF KARENA TUNGGAKAN" }),
      /** Demo: wajah dan sidik jari sama-sama tidak cocok (diatur dari panel demo). */
      peserta("0001234567893", "3273010505700004", "Budi Santoso", "1970-05-05", "L"),
      /** Demo: wajah gagal, sidik jari lolos (diatur dari panel demo). */
      peserta("0001234567894", "3273014606750005", "Dewi Lestari", "1975-06-06", "P"),
      /** Rujukan kedaluwarsa. */
      peserta("0001234567895", "3273010707520006", "Joko Susilo", "1952-07-07", "L"),
      /** Poli berbeda: booking INT, rujukan JAN. */
      peserta("0001234567896", "3273014808650007", "Wati Rahayu", "1965-08-08", "P"),
    ],
    rujukan: [
      rujukan("0301U0011026B000001", "0001234567890", "INT", 30),
      rujukan("0301U0011026B000006", "0001234567895", "INT", 120),
      rujukan("0301U0011026B000007", "0001234567896", "JAN", 10),
    ],
    rencanaKontrol: [
      { noSuratKontrol: "0301R0011026K000001", tglRencanaKontrol: hariIni, poliTujuan: "INT", namaPoliTujuan: "PENYAKIT DALAM", namaDokter: "dr. Fiktif Satu, Sp.PD" },
    ],
    jadwal: [
      { kodepoli: "INT", kodedokter: 101, namadokter: "dr. Fiktif Satu, Sp.PD", jadwal: "08:00-12:00", libur: 0 },
      { kodepoli: "JAN", kodedokter: 102, namadokter: "dr. Fiktif Dua, Sp.JP", jadwal: "13:00-16:00", libur: 0 },
    ],
    booking: [
      booking("BK2026101200017", "PD-017", "0001234567890", "3273010101550001"),
      booking("BK2026101200018", "PD-018", "0001234567896", "3273014808650007"),
    ],
    /** NIK yang sudah punya rekam medis di SIMRS. */
    rmAda: new Set(["3273010101550001", "3273010505700004", "3273014606750005", "3273010707520006", "3273014808650007"]),
  };
}
export type DataMock = ReturnType<typeof buatDataMock>;
