/**
 * Menjalankan skenario contoh lewat kode ASLI (mesin + SDK Jev/Anthropic dengan fetch palsu)
 * dan menulis jejaknya ke JSON. Halaman simulasi dibangun dari file ini, jadi apa yang
 * terlihat di halaman = apa yang dilakukan kode.
 */
import { writeFileSync } from "node:fs";
import { mulai, type Efek, type Keadaan, type KartuLayar } from "../src/mesin.js";
import { proses, type PeristiwaMentah } from "../src/sesi.js";
import type { Jejak, Penilai } from "../src/pemahaman.js";
import { BOOKING_SITI, HARI_INI, KARTU_AHMAD, KARTU_SITI, penilaiPalsu, rujukanUntuk, type JawabClaude, type JawabJev } from "../test/palsu.js";

const JEV: Record<string, JawabJev> = {
  "pakai BPJS": { choice: "bpjs", confidence: 0.94 },
  "sudah booking di Mobile JKN": { choice: "checkin", confidence: 0.9 },
  "iya, boleh": { choice: "ya", confidence: 0.93 },
  "nggih, monggo": { choice: "ya", confidence: 0.88 },
  "kontrol rutin, Nak, tiap bulan": { choice: "kontrol", confidence: 0.9 },
  "bawa surat dari puskesmas": { choice: "rujukan_baru", confidence: 0.91 },
  "kulo ajeng kontrol teng dokter dalem": { choice: "kontrol", confidence: 0.47 },
  "sudah, sudah bener": { choice: "ya", confidence: 0.94 },
  "nggak usah, saya ke loket aja": { choice: "tidak", confidence: 0.86 },
  "kontrol, tapi dada saya sakit sekali": { choice: "kontrol", confidence: 0.81, darurat: 0.78 },
};
const CLAUDE: Record<string, JawabClaude> = {
  "kulo ajeng kontrol teng dokter dalem": { opsi: "kontrol", minta_petugas: false },
};
const normal = (): Penilai =>
  penilaiPalsu((u) => JEV[u] ?? { choice: "tidak_jelas", confidence: 0.9 }, (u) => CLAUDE[u] ?? { opsi: "tidak_jelas", minta_petugas: false });
const putus = (): Penilai => penilaiPalsu(() => "galat", () => "galat");

const U = (t: string): PeristiwaMentah => ({ tipe: "UCAPAN_PASIEN", transkrip: t });

interface Skenario { id: string; judul: string; ringkas: string; penilai: () => Penilai; langkah: [string, PeristiwaMentah][] }

const surKontrol = (k = KARTU_SITI) => ({ ...rujukanUntuk(k), jenis: "surat_kontrol" as const });
const BPJS: [string, PeristiwaMentah] = ["Pasien: “pakai BPJS”", U("pakai BPJS")];
const SETUJU: [string, PeristiwaMentah] = ["Petugas menyetujui di dashboard (nomor antrean dari sistem petugas)", { tipe: "PETUGAS_SETUJU", nomorAntrean: "PD-017" }];

const SKENARIO: Skenario[] = [
  {
    id: "lancar", judul: "Kontrol rutin, lancar", ringkas: "Ibu lansia, semua langkah berhasil pada percobaan pertama; sudah punya RM, jadi diarahkan ke poli.", penilai: normal,
    langkah: [
      BPJS,
      ["Pasien: “iya, boleh”", U("iya, boleh")],
      ["Kartu JKN dipindai (RM ada di SIMRS)", { tipe: "KARTU_TERBACA", identitas: KARTU_SITI, rm: "ada" }],
      ["FRISTA 1:1: cocok", { tipe: "FRISTA", hasil: { hasil: "cocok" } }],
      ["Pasien: “kontrol rutin, Nak, tiap bulan”", U("kontrol rutin, Nak, tiap bulan")],
      ["Surat kontrol dipindai", { tipe: "DOKUMEN_TERBACA", dokumen: surKontrol() }],
      ["Pasien: “sudah, sudah bener”", U("sudah, sudah bener")],
      SETUJU,
    ],
  },
  {
    id: "checkin", judul: "Check-in kode booking", ringkas: "Pasien sudah ambil antrean di Mobile JKN. Kode dipindai dari layar HP, wajah tetap diverifikasi, data dari booking.", penilai: normal,
    langkah: [
      ["Pasien: “sudah booking di Mobile JKN”", U("sudah booking di Mobile JKN")],
      ["Pasien: “iya, boleh”", U("iya, boleh")],
      ["Kode booking dipindai dari layar HP", { tipe: "KODE_BOOKING_TERBACA", identitas: KARTU_SITI, booking: BOOKING_SITI, rm: "ada" }],
      ["FRISTA 1:1: cocok", { tipe: "FRISTA", hasil: { hasil: "cocok" } }],
      ["Pasien: “sudah, sudah bener”", U("sudah, sudah bener")],
      SETUJU,
    ],
  },
  {
    id: "wajah", judul: "Wajah sulit terbaca", ringkas: "Ruang gelap lalu terlalu jauh; kios memandu. Rujukan menulis “Achmad Sudjono” (dianggap ejaan lain, aman) tapi sudah kedaluwarsa, jadi ditandai.", penilai: normal,
    langkah: [
      BPJS,
      ["Pasien: “nggih, monggo”", U("nggih, monggo")],
      ["KTP dipindai (belum punya RM)", { tipe: "KARTU_TERBACA", identitas: KARTU_AHMAD, rm: "belum" }],
      ["FRISTA: wajah tak terdeteksi (gelap)", { tipe: "FRISTA", hasil: { hasil: "wajah_tidak_terdeteksi", sebab: "gelap" } }],
      ["FRISTA: wajah tak terdeteksi (terlalu jauh)", { tipe: "FRISTA", hasil: { hasil: "wajah_tidak_terdeteksi", sebab: "terlalu_jauh" } }],
      ["FRISTA 1:1: cocok", { tipe: "FRISTA", hasil: { hasil: "cocok" } }],
      ["Pasien: “bawa surat dari puskesmas”", U("bawa surat dari puskesmas")],
      ["Rujukan dipindai (ejaan nama lain, berlaku s.d. 1 Okt)", { tipe: "DOKUMEN_TERBACA", dokumen: rujukanUntuk(KARTU_AHMAD, { nama: "Achmad Sudjono", berlakuSampai: "2026-10-01" }) }],
      ["Pasien: “sudah, sudah bener”", U("sudah, sudah bener")],
      ["Petugas memeriksa bendera, lalu mengambil alih", { tipe: "PETUGAS_AMBIL_ALIH" }],
    ],
  },
  {
    id: "jawa", judul: "Bahasa Jawa, Jev ragu", ringkas: "Keyakinan Jev 0,47 (pita tengah), jadi Claude dimintai pendapat kedua dan setuju.", penilai: normal,
    langkah: [
      BPJS,
      ["Pasien: “nggih, monggo”", U("nggih, monggo")],
      ["KTP dipindai", { tipe: "KARTU_TERBACA", identitas: KARTU_AHMAD, rm: "ada" }],
      ["FRISTA 1:1: cocok", { tipe: "FRISTA", hasil: { hasil: "cocok" } }],
      ["Pasien: “kulo ajeng kontrol teng dokter dalem”", U("kulo ajeng kontrol teng dokter dalem")],
      ["Surat kontrol dipindai", { tipe: "DOKUMEN_TERBACA", dokumen: surKontrol(KARTU_AHMAD) }],
      ["Pasien: “sudah, sudah bener”", U("sudah, sudah bener")],
      SETUJU,
    ],
  },
  {
    id: "sidikjari", judul: "Wajah tidak cocok, sidik jari", ringkas: "FRISTA dua kali tidak cocok, sidik jari juga gagal: petugas dipanggil dengan alasan verifikasi_tidak_cocok, tercatat untuk deteksi. Pasien tetap dilayani.", penilai: normal,
    langkah: [
      BPJS,
      ["Pasien: “iya, boleh”", U("iya, boleh")],
      ["Kartu JKN dipindai", { tipe: "KARTU_TERBACA", identitas: KARTU_SITI, rm: "ada" }],
      ["FRISTA 1:1: tidak cocok", { tipe: "FRISTA", hasil: { hasil: "tidak_cocok" } }],
      ["FRISTA 1:1: tidak cocok lagi", { tipe: "FRISTA", hasil: { hasil: "tidak_cocok" } }],
      ["Sidik jari: tidak terbaca", { tipe: "SIDIK_JARI", hasil: { hasil: "tidak_terbaca" } }],
      ["Sidik jari: tidak cocok", { tipe: "SIDIK_JARI", hasil: { hasil: "tidak_cocok" } }],
      ["Petugas datang", { tipe: "PETUGAS_DATANG" }],
      ["Petugas selesai melayani", { tipe: "PETUGAS_SELESAI" }],
    ],
  },
  {
    id: "darurat", judul: "Keluhan darurat", ringkas: "Pasien menyebut nyeri dada. Noul darurat Jev 0,78: petugas dipanggil segera.", penilai: normal,
    langkah: [
      BPJS,
      ["Pasien: “iya, boleh”", U("iya, boleh")],
      ["Kartu JKN dipindai", { tipe: "KARTU_TERBACA", identitas: KARTU_SITI, rm: "ada" }],
      ["FRISTA 1:1: cocok", { tipe: "FRISTA", hasil: { hasil: "cocok" } }],
      ["Pasien: “kontrol, tapi dada saya sakit sekali”", U("kontrol, tapi dada saya sakit sekali")],
      ["Petugas datang", { tipe: "PETUGAS_DATANG" }],
      ["Petugas selesai melayani", { tipe: "PETUGAS_SELESAI" }],
    ],
  },
  {
    id: "putus", judul: "Internet putus", ringkas: "Jev dan Claude tak terjangkau. Kata kunci memahami “BPJS” dan “nggih”, lalu dua jawaban kabur berujung ke petugas.", penilai: putus,
    langkah: [
      BPJS,
      ["Pasien: “nggih, monggo”", U("nggih, monggo")],
      ["KTP dipindai", { tipe: "KARTU_TERBACA", identitas: KARTU_AHMAD, rm: "ada" }],
      ["FRISTA 1:1: cocok", { tipe: "FRISTA", hasil: { hasil: "cocok" } }],
      ["Pasien: “hmm, yang biasa itu lho”", U("hmm, yang biasa itu lho")],
      ["Pasien: “ya itu tadi”", U("ya itu tadi")],
      ["Petugas datang", { tipe: "PETUGAS_DATANG" }],
      ["Petugas selesai melayani", { tipe: "PETUGAS_SELESAI" }],
    ],
  },
  {
    id: "tolak", judul: "Izin ditolak", ringkas: "Pasien tidak mau datanya diproses mesin: kios tidak menyentuh kartu, petugas melayani.", penilai: normal,
    langkah: [
      BPJS,
      ["Pasien: “nggak usah, saya ke loket aja”", U("nggak usah, saya ke loket aja")],
      ["Petugas datang", { tipe: "PETUGAS_DATANG" }],
      ["Petugas selesai melayani", { tipe: "PETUGAS_SELESAI" }],
    ],
  },
];

interface Frame {
  peristiwa: string;
  keadaan: Keadaan["tag"];
  ucapan: string; subtitle: string; ekspresi: string; tempo: number;
  kartu: KartuLayar | null;
  efek: string[];
  jejak: Jejak | null;
}

function ringkasEfek(e: Efek): string | null {
  switch (e.efek) {
    case "bicara": case "tampilkan_kartu": return null;
    case "lampu": return `lampu ${e.target === "wajah" ? "wajah" : "pemindai"} ${e.nyala ? "menyala" : "padam"}`;
    case "kamera": return e.aksi === "naikkan_eksposur" ? "OBSBOT: naikkan eksposur" : "OBSBOT: bingkai wajah otomatis";
    case "panggil_petugas": return `panggil petugas (${e.alasan.replace(/_/g, " ")})${e.prioritas === "segera" ? " · SEGERA" : ""}`;
    case "kirim_draf_ke_petugas": return `draf ke dashboard petugas${e.draf.bendera.length ? ` · ${e.draf.bendera.length} bendera` : ""}`;
    case "cetak_antrean": return `tampilkan nomor antrean ${e.nomorAntrean} · arahan ke ${e.arahan}`;
    case "audit": {
      const c = e.catatan;
      switch (c.jenis) {
        case "izin": return `audit: izin ${c.diberikan ? "diberikan" : "ditolak"} (bercap waktu)`;
        case "frista": return `audit: FRISTA ${c.hasil.replace(/_/g, " ")} (percobaan ${c.percobaan})`;
        case "sidik_jari": return `audit: sidik jari ${c.hasil.replace(/_/g, " ")} (percobaan ${c.percobaan})`;
        case "durasi_sesi": return `audit: durasi sesi ${Math.round(c.ms / 1000)} detik`;
        case "pemahaman": return `audit: jawaban ${c.topik} → ${c.hasil}${c.sumber ? ` via ${c.sumber}` : ""}`;
        case "bendera": return `audit: bendera ${c.bendera.map((b) => b.kolom).join(", ")}`;
        case "eskalasi": return `audit: eskalasi dari ${c.dari}`;
        case "keputusan_petugas": return `audit: petugas ${c.keputusan.replace("_", " ")}`;
        case "diabaikan": return null;
      }
    }
  }
}

async function main() {
  const out = [];
  for (const sk of SKENARIO) {
    const p = sk.penilai();
    let r = mulai(HARI_INI);
    let s = r.berikut;
    const frames: Frame[] = [];
    const ambil = (peristiwa: string, efek: readonly Efek[], jejak: Jejak | null): void => {
      const bicara = [...efek].reverse().find((e) => e.efek === "bicara");
      const kartu = efek.find((e) => e.efek === "tampilkan_kartu");
      const g = bicara && bicara.efek === "bicara" ? bicara.giliran : null;
      const prev = frames[frames.length - 1];
      frames.push({
        peristiwa, keadaan: s.tag,
        ucapan: g?.ucapan ?? prev?.ucapan ?? "", subtitle: g?.subtitle ?? prev?.subtitle ?? "", ekspresi: g?.ekspresi ?? prev?.ekspresi ?? "menyapa", tempo: g?.tempo ?? 0.9,
        kartu: kartu && kartu.efek === "tampilkan_kartu" ? kartu.isi : s.tag === "KONFIRMASI_DATA" || s.tag === "MENUNGGU_PETUGAS_CEK" ? (prev?.kartu ?? null) : null,
        efek: efek.map(ringkasEfek).filter((x): x is string => !!x),
        jejak,
      });
    };
    ambil("Pasien berdiri di depan kios", r.efek, null);
    for (const [label, pm] of sk.langkah) {
      const rr = await proses(s, pm, p);
      s = rr.berikut;
      ambil(label, rr.efek, rr.jejak ?? null);
    }
    out.push({ id: sk.id, judul: sk.judul, ringkas: sk.ringkas, hasil: s.tag === "SELESAI" ? s.hasil : s.tag, frames });
  }
  writeFileSync(new URL("../jejak-skenario.json", import.meta.url), JSON.stringify(out, null, 1));
  console.log(out.map((o) => `${o.id}: ${o.frames.map((f) => f.keadaan).join(" → ")} [${o.hasil}]`).join("\n"));
}
main();
