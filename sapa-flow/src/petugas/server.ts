/**
 * Dashboard petugas: node:http + SSE (sementara; nanti web/ React + WS dengan kontrak yang sama).
 *  - Masuk dengan PIN dari .env (DASHBOARD_PIN) + nama petugas; cookie HttpOnly SameSite=Strict.
 *  - Kartu hanya untuk sesi di MEMANGGIL_PETUGAS / MENUNGGU_PETUGAS_CEK; nilai kolom ragu hanya di memori
 *    dan dibuang saat sesi SELESAI. Audit mencatat nama kolom dan keputusan petugas saja.
 *  - Kode ini satu-satunya tempat keputusan "tulis" (Setuju → nomor antrean dari sistem RS lewat `aksi`).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AksiPetugasSchema, KePetugasSchema, type DariPetugas, type KePetugas } from "./kontrak.js";

export interface CatatanAuditPetugas {
  readonly waktu: string;
  readonly idSesi: string;
  readonly keputusan: DariPetugas["t"];
  readonly petugas: string;
  /** Nama kolom saja, tanpa nilai. */
  readonly kolomRagu: readonly string[];
}

export interface OpsiDashboard {
  readonly pin: string;
  /** Meneruskan keputusan ke kios (dan sistem RS untuk Setuju). */
  readonly aksi: (a: DariPetugas) => Promise<void>;
  readonly catatAudit: (c: CatatanAuditPetugas) => void;
}

type Kartu = { sesi?: Extract<KePetugas, { t: "sesi" }>; panggil?: Extract<KePetugas, { t: "panggil" }>; draf?: Extract<KePetugas, { t: "draf" }> };

/** Keputusan yang sah per keadaan; selain itu 409. */
const BOLEH: Record<DariPetugas["t"], string> = {
  setuju: "MENUNGGU_PETUGAS_CEK",
  ambil_alih: "MENUNGGU_PETUGAS_CEK",
  datang: "MEMANGGIL_PETUGAS",
  selesai: "MEMANGGIL_PETUGAS",
};

const sidik = (s: string) => createHash("sha256").update(s).digest();
const pinBenar = (pin: string, coba: string) => timingSafeEqual(sidik(pin), sidik(coba));

async function bacaBody(req: IncomingMessage): Promise<string> {
  let teks = "";
  for await (const potong of req) {
    teks += potong;
    if (teks.length > 10_000) break;
  }
  return teks;
}

export function buatDashboard(o: OpsiDashboard) {
  if (o.pin.length < 4) throw new Error("DASHBOARD_PIN minimal 4 karakter");
  const kartu = new Map<string, Kartu>();
  const login = new Map<string, string>(); // token → nama petugas
  const pendengar = new Set<ServerResponse>();

  const pesanKartu = (k: Kartu) => [k.sesi, k.panggil, k.draf].filter((x) => x !== undefined);
  const kirimSse = (res: ServerResponse, p: KePetugas) => res.write(`data: ${JSON.stringify(p)}\n\n`);

  function terima(masuk: KePetugas) {
    const p = KePetugasSchema.parse(masuk);
    if (p.t === "sesi" && p.tag !== "MEMANGGIL_PETUGAS" && p.tag !== "MENUNGGU_PETUGAS_CEK") {
      kartu.delete(p.idSesi); // nilai ragu tidak disimpan lebih lama dari panggilan
    } else {
      kartu.set(p.idSesi, { ...kartu.get(p.idSesi), [p.t]: p });
    }
    for (const res of pendengar) kirimSse(res, p);
  }

  function petugasDari(req: IncomingMessage): string | null {
    const token = /(?:^|;\s*)petugas=([a-f0-9]{64})/.exec(req.headers.cookie ?? "")?.[1];
    return token ? (login.get(token) ?? null) : null;
  }

  const kirim = (res: ServerResponse, status: number, jenis: string, isi: string): void => {
    res.writeHead(status, { "content-type": jenis, "cache-control": "no-store", "x-frame-options": "DENY" }).end(isi);
  };

  const server = createServer(async (req, res): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://dashboard");

    if (req.method === "POST" && url.pathname === "/masuk") {
      const f = new URLSearchParams(await bacaBody(req));
      const nama = (f.get("nama") ?? "").trim().slice(0, 40);
      // ponytail: tanpa pembatas percobaan PIN; tambahkan bila dashboard keluar dari jaringan lokal RS.
      if (!nama || !pinBenar(o.pin, f.get("pin") ?? "")) return kirim(res, 401, "text/html; charset=utf-8", halamanMasuk("PIN atau nama salah."));
      const token = randomBytes(32).toString("hex");
      login.set(token, nama);
      return void res.writeHead(303, { location: "/", "set-cookie": `petugas=${token}; HttpOnly; SameSite=Strict; Path=/` }).end();
    }

    const petugas = petugasDari(req);
    if (!petugas) {
      if (req.method === "GET" && url.pathname === "/") return kirim(res, 200, "text/html; charset=utf-8", halamanMasuk(""));
      return kirim(res, 401, "application/json", JSON.stringify({ pesan: "Belum masuk" }));
    }

    if (req.method === "GET" && url.pathname === "/") return kirim(res, 200, "text/html; charset=utf-8", halamanDashboard(petugas));

    if (req.method === "GET" && url.pathname === "/peristiwa") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": tersambung\n\n"); // header langsung terkirim walau belum ada kartu
      for (const k of kartu.values()) for (const p of pesanKartu(k)) kirimSse(res, p);
      pendengar.add(res);
      req.on("close", () => pendengar.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/aksi") {
      if (!/^application\/json/.test(req.headers["content-type"] ?? "")) return kirim(res, 415, "application/json", "{}");
      let aksi;
      try {
        aksi = AksiPetugasSchema.parse(JSON.parse(await bacaBody(req)));
      } catch {
        return kirim(res, 400, "application/json", JSON.stringify({ pesan: "Aksi tidak valid" }));
      }
      const k = kartu.get(aksi.idSesi);
      if (k?.sesi?.tag !== BOLEH[aksi.t]) return kirim(res, 409, "application/json", JSON.stringify({ pesan: "Aksi tidak sesuai keadaan sesi" }));
      o.catatAudit({ waktu: new Date().toISOString(), idSesi: aksi.idSesi, keputusan: aksi.t, petugas, kolomRagu: (k.draf?.kolomRagu ?? []).map((r) => r.kolom) });
      await o.aksi({ ...aksi, petugas });
      return kirim(res, 204, "application/json", "");
    }

    kirim(res, 404, "application/json", "{}");
  });

  return { server, terima };
}

// ---------------------------------------------------------------- tampilan (data dirender lewat textContent, tidak pernah innerHTML)
const GAYA = `
:root { --bg:#edf2ef; --surface:#fff; --ink:#10302a; --muted:#4f665f; --line:#d2ddd7; --brand:#17724f; --warn:#b9501a; --warn-soft:#fbe9dc; --ragu:#fff3c4; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1a17; --surface:#12271f; --ink:#e3eee9; --muted:#9db5ad; --line:#24413a; --brand:#5cc596; --warn:#f0a162; --warn-soft:#3a2517; --ragu:#4a3f12; color-scheme: dark; } }
* { box-sizing: border-box; } body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.45 "Segoe UI", system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 16px; } h1 { font-size: 1.4rem; margin: 0 0 4px; } .muted { color: var(--muted); }
.kartu { background:var(--surface); border:1px solid var(--line); border-left:6px solid var(--brand); border-radius:10px; padding:14px 16px; margin:12px 0; }
.kartu.segera { border-left-color: var(--warn); background: var(--warn-soft); }
.kepala { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:baseline; justify-content:space-between; }
.alasan { font-weight:700; font-size:1.1rem; } .lencana { font-size:.8rem; font-weight:700; padding:2px 8px; border-radius:99px; background:var(--warn); color:#fff; }
table { width:100%; border-collapse:collapse; margin-top:10px; font-size:.95rem; } th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
td.ragu { background: var(--ragu); } .tombol { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
button { font:inherit; font-weight:600; padding:10px 18px; border-radius:8px; border:1px solid var(--brand); background:var(--brand); color:#fff; cursor:pointer; }
button.kedua { background:transparent; color:var(--brand); } button:disabled { opacity:.5; cursor:default; }
form { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:16px; max-width:360px; }
label { display:block; margin:10px 0 4px; font-weight:600; } input { font:inherit; width:100%; padding:8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink); }
.galat { color: var(--warn); }`;

const halamanMasuk = (galat: string) => `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Petugas</title><style>${GAYA}</style></head><body><main>
<h1>Dashboard Petugas</h1><p class="muted">Kios APP AI · data fiktif</p>
<form method="post" action="/masuk">
<label for="nama">Nama petugas</label><input id="nama" name="nama" required maxlength="40" autocomplete="name">
<label for="pin">PIN</label><input id="pin" name="pin" type="password" required inputmode="numeric" autocomplete="off">
${galat ? `<p class="galat" role="alert">${galat}</p>` : ""}
<div class="tombol"><button type="submit">Masuk</button></div></form></main></body></html>`;

const halamanDashboard = (petugas: string) => `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Petugas</title><style>${GAYA}</style></head><body><main>
<h1>Panggilan kios</h1><p class="muted">Masuk sebagai <span id="petugas"></span>. Nilai hanya untuk kolom yang ditandai ragu.</p>
<div id="daftar" aria-live="polite"><p class="muted">Belum ada panggilan.</p></div>
</main><script>
document.getElementById("petugas").textContent = ${JSON.stringify(petugas)};
const ALASAN = { izin_ditolak:"Pasien menolak izin", diminta_pasien:"Diminta pasien", kartu_tak_terbaca:"Kartu tak terbaca", peserta_tidak_aktif:"Peserta tidak aktif",
  verifikasi_tidak_cocok:"Verifikasi tidak cocok", verifikasi_tak_terbaca:"Verifikasi tak terbaca", jawaban_tidak_jelas:"Jawaban tidak jelas", diam_terlalu_lama:"Pasien diam terlalu lama",
  kebutuhan_lain:"Kebutuhan lain", dokumen_tak_terbaca:"Dokumen tak terbaca", data_dikoreksi_pasien:"Data dikoreksi pasien", layanan_ai_terputus:"Layanan AI terputus",
  kemungkinan_darurat:"KEMUNGKINAN DARURAT", non_bpjs:"Non BPJS", admission:"Admission / rawat inap", kode_booking_tak_terbaca:"Kode booking tak terbaca", waktu_habis:"Waktu sesi habis" };
const KOLOM = { nama:"Nama", nik:"NIK", nomorKartu:"Nomor kartu", tanggalLahir:"Tanggal lahir", berlakuSampai:"Berlaku s.d.", poliTujuan:"Poli tujuan", jenis_dokumen:"Jenis dokumen" };
const kartu = new Map();
const el = (tag, kelas, teks) => { const e = document.createElement(tag); if (kelas) e.className = kelas; if (teks !== undefined) e.textContent = teks; return e; };
const durasi = (ms) => { const d = Math.max(0, Math.floor(ms / 1000)); return Math.floor(d / 60) + " mnt " + String(d % 60).padStart(2, "0") + " dtk"; };
async function aksi(t, idSesi, tombol) {
  tombol.disabled = true;
  const r = await fetch("/aksi", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, idSesi }) });
  if (!r.ok) { tombol.disabled = false; alert("Gagal: " + r.status); }
}
function gambar() {
  const daftar = document.getElementById("daftar");
  const isi = [...kartu.entries()].filter(([, k]) => k.sesi).sort(([, a], [, b]) =>
    ((b.panggil?.prioritas === "segera") - (a.panggil?.prioritas === "segera")) || (a.sesi.mulai - b.sesi.mulai));
  daftar.replaceChildren();
  if (!isi.length) return daftar.append(el("p", "muted", "Belum ada panggilan."));
  for (const [id, k] of isi) {
    const cek = k.sesi.tag === "MENUNGGU_PETUGAS_CEK";
    const kotak = el("section", "kartu" + (k.panggil?.prioritas === "segera" ? " segera" : ""));
    const kepala = el("div", "kepala");
    kepala.append(el("span", "alasan", cek ? "Draf menunggu pemeriksaan" : (ALASAN[k.panggil?.alasan] ?? "Panggilan")));
    if (k.panggil?.prioritas === "segera") kepala.append(el("span", "lencana", "SEGERA"));
    const dur = el("span", "muted durasi"); dur.dataset.mulai = k.sesi.mulai; dur.textContent = "Durasi sesi " + durasi(Date.now() - k.sesi.mulai);
    kepala.append(dur);
    kotak.append(kepala);
    if (k.sesi.petugasDatang) kotak.append(el("p", "muted", "Petugas sudah di kios."));
    const ragu = k.draf?.kolomRagu ?? [];
    if (ragu.length) {
      const tabel = el("table"); const h = el("tr");
      for (const j of ["Kolom ragu", "Kartu", "Dokumen"]) h.append(el("th", "", j));
      tabel.append(h);
      for (const r of ragu) {
        const b = el("tr");
        b.append(el("td", "", KOLOM[r.kolom] ?? r.kolom), el("td", "ragu", r.kartu ?? "–"), el("td", "ragu", r.dokumen ?? "–"));
        tabel.append(b);
      }
      kotak.append(tabel);
    } else if (k.draf) kotak.append(el("p", "muted", "Tidak ada kolom yang ditandai ragu."));
    const tombol = el("div", "tombol");
    const pasang = (t, label, kedua) => { const b = el("button", kedua ? "kedua" : "", label); b.onclick = () => aksi(t, id, b); tombol.append(b); };
    if (cek) { pasang("setuju", "Setuju"); pasang("ambil_alih", "Ambil alih", true); }
    else if (!k.sesi.petugasDatang) { pasang("datang", "Saya datang"); pasang("selesai", "Selesai", true); }
    else pasang("selesai", "Selesai");
    kotak.append(tombol);
    daftar.append(kotak);
  }
}
const sumber = new EventSource("/peristiwa");
sumber.onmessage = (m) => {
  const p = JSON.parse(m.data);
  if (p.t === "sesi" && p.tag !== "MEMANGGIL_PETUGAS" && p.tag !== "MENUNGGU_PETUGAS_CEK") kartu.delete(p.idSesi);
  else kartu.set(p.idSesi, { ...kartu.get(p.idSesi), [p.t]: p });
  gambar();
};
setInterval(() => { for (const d of document.querySelectorAll(".durasi")) d.textContent = "Durasi sesi " + durasi(Date.now() - Number(d.dataset.mulai)); }, 1000);
</script></body></html>`;
