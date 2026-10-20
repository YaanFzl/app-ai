/**
 * Demo dashboard: kios (adaptor palsu + server mock BPJS) ↔ dashboard petugas lewat kontrak `KePetugas` / `DariPetugas`.
 * Skenario dijalankan berurutan; skenario berikut baru mulai setelah kios membuka kunci (sesi SELESAI).
 * Nomor antrean dibuat "sistem RS" palsu di sini (kios dilarang "antrean add").
 */
import type { Pengemudi } from "../adaptor/pengemudi.js";
import type { Poli } from "../domain.js";
import { buatKios } from "../kios.js";
import { pesanDariEfek, pesanSesi } from "../petugas/kontrak.js";
import { buatDashboard, type CatatanAuditPetugas } from "../petugas/server.js";
import { buatSesi } from "../sesi.js";
import { OPSI_BAWAAN, mainkan, siapkanBpjsMock, type OpsiDemo } from "./demo.js";

export const SKENARIO_DASHBOARD: readonly OpsiDemo[] = [
  { ...OPSI_BAWAAN, dokumen: "ragu" }, // draf menunggu cek, kolom nama + berlaku s.d. ragu
  { ...OPSI_BAWAAN, peserta: "budi", wajah: "tidakcocok", sidikjari: "tidakcocok" }, // panggilan: verifikasi tidak cocok
  { ...OPSI_BAWAAN, mode: "nonbpjs" }, // panggilan: Non BPJS
];

const KODE_ANTREAN: Record<Poli, string> = { penyakit_dalam: "PD", jantung: "JT", saraf: "SR", mata: "MT", paru: "PR", bedah: "BD", lainnya: "UM" };

export async function jalankanDashboardDemo(o: {
  pin: string;
  hariIni: string;
  skenario?: readonly OpsiDemo[];
  catatAudit: (c: CatatanAuditPetugas) => void;
}) {
  const { klien, tutup } = await siapkanBpjsMock(o.hariIni);
  const kios = buatKios(() => buatSesi(o.hariIni, { jev: null, claude: null }));
  let pengemudi: Pengemudi | null = null;
  let urut = 0;

  const dashboard = buatDashboard({
    pin: o.pin,
    catatAudit: o.catatAudit,
    aksi: async (a) => {
      const aktif = kios.aktif();
      if (!aktif || aktif.idSesi !== a.idSesi || !pengemudi) return;
      switch (a.t) {
        case "setuju": {
          const k = aktif.sesi.keadaan().k;
          const poli = k.booking?.poli ?? k.dokumen?.poliTujuan.nilai ?? "lainnya";
          return pengemudi.petugas({ tipe: "PETUGAS_SETUJU", nomorAntrean: `${KODE_ANTREAN[poli]}-${String(++urut).padStart(3, "0")}` });
        }
        case "ambil_alih":
          return pengemudi.petugas({ tipe: "PETUGAS_AMBIL_ALIH" });
        case "datang":
          return pengemudi.petugas({ tipe: "PETUGAS_DATANG" });
        case "selesai":
          return pengemudi.petugas({ tipe: "PETUGAS_SELESAI" });
      }
    },
  });

  const selesai = (async () => {
    const hasil = [];
    for (const opsi of o.skenario ?? SKENARIO_DASHBOARD) {
      let aktif = kios.mulaiSesi();
      while (!aktif) {
        await new Promise((r) => setTimeout(r, 200));
        aktif = kios.mulaiSesi();
      }
      const { idSesi, sesi } = aktif;
      dashboard.terima(pesanSesi(idSesi, sesi.mulai, sesi.keadaan()));
      hasil.push(
        await mainkan(opsi, {
          klien,
          hariIni: o.hariIni,
          sesi,
          petugasDariLuar: true,
          pengemudiSiap: (p) => void (pengemudi = p),
          setelahKirim: (s) => dashboard.terima(pesanSesi(idSesi, sesi.mulai, s)),
          lainnya: (e) => {
            const p = pesanDariEfek(idSesi, e);
            if (p) dashboard.terima(p);
          },
        }),
      );
    }
    return hasil;
  })();

  return { dashboard, kios, selesai, tutup };
}
