/**
 * Demo layar kios: pasien mengetuk layar (atau bicara, nanti); panel palsu berperan sebagai perangkat
 * (kartu, biometrik, dokumen) dan petugas (setuju / datang / selesai setelah jeda).
 */
import type { Pengemudi } from "../adaptor/pengemudi.js";
import { buatKios } from "../kios.js";
import { pesanDariEfek, pesanKeadaan } from "../kios-layar/kontrak.js";
import { buatLayarKios } from "../kios-layar/server.js";
import { buatSesi } from "../sesi.js";
import { OPSI_BAWAAN, mainkan, siapkanBpjsMock, type OpsiDemo } from "./demo.js";

export async function jalankanKiosDemo(o: { hariIni: string; opsi?: OpsiDemo; jedaPetugasMs?: number }) {
  const { klien, tutup } = await siapkanBpjsMock(o.hariIni);
  const kios = buatKios(() => buatSesi(o.hariIni, { jev: null, claude: null }));
  let pengemudi: Pengemudi | null = null;

  const layar = buatLayarKios(async (d) => {
    if (d.t === "mulai") {
      const aktif = kios.mulaiSesi();
      if (!aktif) return; // kios terkunci: sesi lama belum selesai
      pengemudi = null;
      layar.kirim(pesanKeadaan(aktif.sesi.keadaan()));
      void mainkan(o.opsi ?? OPSI_BAWAAN, {
        klien,
        hariIni: o.hariIni,
        sesi: aktif.sesi,
        pasienDariLuar: true,
        jedaPetugasMs: o.jedaPetugasMs ?? 2000,
        pengemudiSiap: (p) => void (pengemudi = p),
        setelahKirim: (s) => layar.kirim(pesanKeadaan(s)),
        bagikan: (e) => {
          const p = pesanDariEfek(e);
          if (p) layar.kirim(p);
        },
      });
      return;
    }
    if (!pengemudi) return;
    if (d.t === "pilih") return pengemudi.layar({ tipe: "SENTUH_OPSI", opsi: d.opsi });
    return pengemudi.layar({ tipe: d.nama === "ulangi" ? "TOMBOL_ULANGI" : "TOMBOL_PETUGAS" });
  });

  return { layar, kios, tutup };
}
