/**
 * Halaman layar sentuh kios. Desain utama potret 1080×1920; lanskap 1920×1080 (laptop demo) jadi dua kolom.
 * Ukuran huruf memakai px tetap, jadi zoom browser 200% benar-benar memperbesar; tata letak mengalir ulang.
 * Semua data dirender lewat textContent (tidak pernah innerHTML). Avatar: WebM VP9 alpha, cadangan frame PNG
 * untuk browser tanpa VP9 alpha (`?avatar=png` memaksa cadangan).
 */
export const HALAMAN_KIOS = `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sapa</title>
<style>
:root { --bg:#10302a; --bg2:#1a4239; --ink:#f4f2ee; --muted:#b9d3c9; --aksen:#a6d35a; --aksen-ink:#10302a; --garis:#2f5a50;
  --ragu:#ffe27a; --ragu-ink:#2a2000; --bahaya:#f0a162; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin:0; height:100%; background:var(--bg); color:var(--ink); font:28px/1.35 "Segoe UI", system-ui, sans-serif; }
body { display:grid; grid-template-rows:auto minmax(0,1fr) auto; height:100dvh; overflow-x:hidden; }
button { font:inherit; color:inherit; cursor:pointer; touch-action:manipulation; }
button:focus-visible { outline:6px solid var(--ragu); outline-offset:4px; }

header { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; justify-content:space-between; padding:16px 24px; border-bottom:2px solid var(--garis); }
.merek { font-weight:800; font-size:24px; letter-spacing:.02em; }
.lampu { display:flex; gap:12px; flex-wrap:wrap; }
.lampu span { font-size:20px; padding:4px 14px; border-radius:99px; border:2px solid var(--garis); color:var(--muted); }
.lampu span.nyala { background:var(--aksen); color:var(--aksen-ink); border-color:var(--aksen); font-weight:700; }

#utama { display:flex; flex-direction:column; min-height:0; overflow-y:auto; overflow-x:hidden; }
.panggung { display:flex; flex-direction:column; align-items:center; gap:16px; padding:24px 24px 8px; }
.avatar { width:100%; height:clamp(160px, 30vh, 600px); display:flex; justify-content:center; }
.avatar video, .avatar img { height:100%; max-width:100%; object-fit:contain; }
#subtitle { margin:0; text-align:center; font-weight:700; font-size:56px; line-height:1.2; max-width:22ch; overflow-wrap:anywhere; }
.isi { display:flex; flex-direction:column; gap:24px; padding:16px 24px 32px; }

/* Tombol jawaban menempel di bawah area gulir: selalu terlihat walau kartu panjang. */
.opsi { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap:20px;
  position:sticky; bottom:0; z-index:1; background:var(--bg); padding:12px 0 4px; }
.opsi button { min-height:128px; padding:20px 24px; border-radius:24px; border:4px solid var(--aksen); background:var(--aksen); color:var(--aksen-ink);
  font-size:40px; font-weight:800; overflow-wrap:anywhere; }
.opsi button.kedua { background:transparent; color:var(--ink); }
/* Tombol mulai / pasien berikutnya juga menempel di bawah area gulir. */
.mulai { position:sticky; bottom:0; z-index:1; min-height:220px; border-radius:32px; border:4px solid var(--aksen); background:var(--aksen); color:var(--aksen-ink); font-size:52px; font-weight:800; padding:24px; }

.kartu { background:var(--bg2); border:2px solid var(--garis); border-radius:24px; padding:20px 24px; }
.kartu h2 { margin:0 0 8px; font-size:32px; }
.kartu dl { margin:0; display:grid; grid-template-columns:fit-content(40%) minmax(0,1fr); gap:4px 24px; align-items:baseline; }
.kartu dt { color:var(--muted); font-size:26px; padding:10px 0; }
.kartu dd { margin:0; font-size:38px; font-weight:700; padding:10px 0; overflow-wrap:break-word; }
.kartu .ragu { background:var(--ragu); color:var(--ragu-ink); border-radius:10px; padding:10px 14px; }
.kartu .ragu small { display:block; font-size:22px; font-weight:700; }

.antrean { text-align:center; background:var(--ink); color:var(--bg); border-radius:32px; padding:28px 24px; }
.antrean .label { font-size:32px; font-weight:700; }
.antrean .nomor { font-size:132px; font-weight:900; line-height:1.05; letter-spacing:.02em; overflow-wrap:anywhere; }
.antrean .arah { font-size:40px; font-weight:800; }
.petugas { text-align:center; font-size:40px; font-weight:800; border:4px solid var(--ink); border-radius:24px; padding:24px; }
.petugas.segera { border-color:var(--bahaya); color:var(--bahaya); }

footer { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:16px 24px 24px; border-top:2px solid var(--garis); background:var(--bg); }
footer button { min-height:104px; border-radius:24px; font-size:34px; font-weight:800; border:4px solid var(--ink); background:transparent; overflow-wrap:anywhere; padding:8px 16px; }
footer button.petugas-btn { background:var(--ink); color:var(--bg); }
footer button[aria-disabled="true"] { opacity:.45; }

/* Sempit (potret kecil / zoom 200%): huruf TIDAK mengecil di bawah ukuran minimum (subtitle ≥ 48px). */
@media (max-width: 640px) {
  html, body { font-size:24px; }
  #subtitle { font-size:48px; }
  header { flex-wrap:nowrap; padding:8px 16px; } .merek { font-size:18px; } .lampu { gap:8px; } .lampu span { font-size:16px; padding:2px 10px; }
  .panggung { padding:12px 16px 0; gap:8px; } .avatar { height:96px; }
  .isi { padding:8px 16px 0; gap:16px; }
  /* Dua kolom supaya empat tombol mode tetap terlihat tanpa gulir. */
  .opsi { grid-template-columns:1fr 1fr; gap:12px; }
  .opsi button { font-size:28px; min-height:96px; padding:12px; border-radius:20px; }
  .antrean .nomor { font-size:96px; }
  /* Ringkasan tetap dua kolom dan padat supaya seluruh data tampak tanpa gulir. */
  .kartu { padding:12px 16px; } .kartu h2 { font-size:24px; margin-bottom:4px; }
  .kartu dl { grid-template-columns:fit-content(42%) minmax(0,1fr); gap:0 12px; }
  .kartu dt { font-size:20px; padding:6px 0; } .kartu dd { font-size:30px; padding:4px 0; }
  .kartu .ragu small { font-size:18px; }
  footer { gap:12px; padding:12px 16px 16px; } footer button { font-size:28px; min-height:96px; }
}
/* Pendek (lanskap kecil / zoom 200%): satu kolom, avatar kecil di samping subtitle, tombol tetap terlihat. */
@media (max-height: 700px) {
  header { padding:6px 16px; } .merek { font-size:20px; } .lampu span { font-size:18px; padding:2px 10px; }
  .panggung { flex-direction:row; justify-content:center; padding:12px 24px 0; }
  .avatar { width:auto; flex:none; height:120px; }
  #subtitle { text-align:left; max-width:none; }
  .isi { gap:16px; padding:8px 24px 0; }
  .opsi button { min-height:88px; padding:12px 20px; font-size:32px; }
  .mulai { min-height:96px; font-size:36px; padding:12px; }
  .antrean { padding:12px 16px; } .antrean .nomor { font-size:88px; } .antrean .label, .antrean .arah { font-size:28px; }
  footer { padding:10px 16px 12px; } footer button { min-height:72px; font-size:28px; }
}
/* Lanskap pendek (laptop + zoom 200%): isi dua kolom (ringkasan / antrean | tombol), semua tampak tanpa gulir. */
@media (orientation: landscape) and (max-height: 700px) {
  #subtitle { line-height:1.1; }
  .opsi button { font-size:28px; min-height:80px; }
  .isi:has(.kartu), .isi:has(.antrean) { display:grid; grid-template-columns:minmax(0,3fr) minmax(0,2fr); align-items:start; }
  .isi:has(.kartu) .opsi { grid-template-columns:1fr; position:static; padding:0; }
  .isi:has(.antrean) .mulai { position:static; min-height:120px; }
  .kartu { padding:8px 16px; } .kartu h2 { font-size:22px; margin-bottom:2px; }
  .kartu dt { font-size:18px; padding:2px 0; } .kartu dd { font-size:26px; padding:2px 0; }
  .kartu dt, .kartu dd { line-height:1.15; } .kartu dd { font-size:24px; }
  /* Judul kartu tetap dibaca pembaca layar; subtitle sudah menanyakan "Data di layar…". */
  .kartu h2 { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
  .avatar { height:96px; }
  .panggung { padding-top:8px; } .isi { gap:12px; }
  .antrean .nomor { font-size:72px; }
}
/* Lanskap lebar dan cukup tinggi (laptop demo): avatar + subtitle kiri, isi kanan; masing-masing digulir sendiri. */
@media (orientation: landscape) and (min-width: 900px) and (min-height: 701px) {
  #utama { display:grid; grid-template-columns:minmax(0,5fr) minmax(0,6fr); overflow:hidden; }
  .panggung, .isi { overflow-y:auto; min-height:0; }
  .panggung { justify-content:center; }
  .avatar { height:clamp(140px, 40vh, 520px); }
}
@media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
</style></head>
<body>
<header><span class="merek">APP AI · Pendaftaran</span>
  <div class="lampu" aria-label="Status alat"><span id="lampu-pemindai">Pemindai</span><span id="lampu-wajah">Kamera</span></div></header>
<main id="utama">
  <section class="panggung">
    <div class="avatar" id="avatar" role="img" aria-label="Sapa, pemandu kios"></div>
    <p id="subtitle" aria-live="polite"></p>
  </section>
  <section class="isi" id="isi"></section>
</main>
<footer>
  <button id="ulangi" type="button">Ulangi</button>
  <button id="petugas" type="button" class="petugas-btn">Panggil Petugas</button>
</footer>
<script>
const KLIP = { siaga:"idle", menyapa:"menyapa", mendengar:"mendengarkan", memandu:"memandu-wajah", petugas:"memanggil-petugas", senang:"senang" };
const JUMLAH_FRAME = { idle:72, menyapa:48, mendengarkan:58, "memandu-wajah":48, "memanggil-petugas":48, senang:38 };
const st = { tag:"SIAGA", opsi:[], subtitle:"Selamat datang. Sentuh layar untuk mulai.", ekspresi:"siaga", kartu:null, antrean:null, petugas:null, lampu:{ pemindai:false, wajah:false } };
const el = (tag, kelas, teks) => { const e = document.createElement(tag); if (kelas) e.className = kelas; if (teks !== undefined) e.textContent = teks; return e; };
const kirim = (d) => fetch("/tombol", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(d) });

// ---------- avatar: WebM VP9 alpha, atau frame PNG
const paksaPng = new URLSearchParams(location.search).get("avatar") === "png";
const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
const bisaWebm = !paksaPng && !safari && document.createElement("video").canPlayType('video/webm; codecs="vp9"') !== "";
const diam = matchMedia("(prefers-reduced-motion: reduce)").matches;
const kotakAvatar = document.getElementById("avatar");
let pemutar = null, klipSekarang = "";
function aturAvatar(ekspresi) {
  const klip = KLIP[ekspresi] || "idle";
  if (klip === klipSekarang) return;
  klipSekarang = klip;
  clearInterval(pemutar);
  kotakAvatar.replaceChildren();
  kotakAvatar.dataset.mode = bisaWebm ? "webm" : "png";
  if (bisaWebm) {
    const v = el("video"); v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = !diam; v.src = "/sapa/sapa-" + klip + ".webm";
    v.setAttribute("aria-hidden", "true"); kotakAvatar.append(v); return;
  }
  // Semua frame dimuat dulu (cache browser); animasi baru jalan setelah lengkap, jadi tidak berkedip kosong.
  const url = Array.from({ length: JUMLAH_FRAME[klip] }, (_, n) => "/sapa/frame-png/" + klip + "/" + String(n).padStart(3, "0") + ".png");
  const img = el("img"); img.alt = ""; img.src = url[0]; kotakAvatar.append(img);
  if (diam) return;
  Promise.all(url.map((u) => new Promise((ok) => { const m = new Image(); m.onload = m.onerror = ok; m.src = u; }))).then(() => {
    if (klipSekarang !== klip) return;
    let i = 0;
    pemutar = setInterval(() => { i = (i + 1) % url.length; img.src = url[i]; }, 1000 / 24);
  });
}

// ---------- gambar ulang
function gambar() {
  document.getElementById("subtitle").textContent = st.subtitle;
  aturAvatar(st.ekspresi);
  for (const t of ["pemindai", "wajah"]) document.getElementById("lampu-" + t).classList.toggle("nyala", st.lampu[t]);
  const sesi = st.tag !== "SIAGA" && st.tag !== "SELESAI";
  for (const id of ["ulangi", "petugas"]) document.getElementById(id).setAttribute("aria-disabled", String(!sesi));

  const isi = document.getElementById("isi");
  isi.replaceChildren();
  if (st.tag === "SIAGA" || (st.tag === "SELESAI" && !st.antrean)) {
    const b = el("button", "mulai", st.tag === "SIAGA" ? "Sentuh untuk mulai" : "Pasien berikutnya");
    b.type = "button"; b.dataset.aksi = "mulai"; b.onclick = () => kirim({ t:"mulai" }); isi.append(b);
  }
  if (st.petugas && st.tag === "MEMANGGIL_PETUGAS") {
    isi.append(el("div", "petugas" + (st.petugas === "segera" ? " segera" : ""), st.petugas === "segera" ? "Petugas dipanggil SEKARANG" : "Petugas sedang menuju ke sini"));
  }
  if (st.kartu) {
    const k = el("section", "kartu"); k.append(el("h2", "", st.kartu.judul));
    const dl = el("dl");
    for (const b of st.kartu.baris) {
      dl.append(el("dt", "", b.label));
      const dd = el("dd", b.ragu ? "ragu" : "", b.nilai);
      if (b.ragu) dd.append(el("small", "", "Mohon dicek"));
      dl.append(dd);
    }
    k.append(dl); isi.append(k);
  }
  if (st.antrean) {
    const a = el("section", "antrean");
    a.append(el("div", "label", "Nomor antrean"), el("div", "nomor", st.antrean.nomorAntrean), el("div", "arah", st.antrean.arahan === "poli" ? "Silakan ke poli" : "Silakan ke admisi dulu"));
    isi.append(a);
    const b = el("button", "mulai", "Pasien berikutnya"); b.type = "button"; b.dataset.aksi = "mulai"; b.onclick = () => kirim({ t:"mulai" }); isi.append(b);
  }
  if (st.opsi.length) {
    const g = el("div", "opsi"); g.setAttribute("role", "group"); g.setAttribute("aria-label", "Pilihan jawaban");
    st.opsi.forEach((o, i) => {
      const b = el("button", i > 0 && st.opsi.length === 2 ? "kedua" : "", o.label);
      b.type = "button"; b.dataset.opsi = o.nilai; b.onclick = () => kirim({ t:"pilih", opsi:o.nilai }); g.append(b);
    });
    isi.append(g);
  }
}
document.getElementById("ulangi").onclick = () => { if (st.tag !== "SIAGA") kirim({ t:"tombol", nama:"ulangi" }); };
document.getElementById("petugas").onclick = () => { if (st.tag !== "SIAGA") kirim({ t:"tombol", nama:"petugas" }); };

new EventSource("/peristiwa").onmessage = (m) => {
  const p = JSON.parse(m.data);
  switch (p.t) {
    case "keadaan":
      if (p.tag !== st.tag) { st.kartu = null; st.antrean = null; if (p.tag !== "MEMANGGIL_PETUGAS") st.petugas = null; }
      if (p.tag === "SIAGA") { st.subtitle = "Selamat datang. Sentuh layar untuk mulai."; st.ekspresi = "siaga"; }
      st.tag = p.tag; st.opsi = p.opsi; break;
    case "bicara": st.subtitle = p.subtitle; st.ekspresi = p.ekspresi; break;
    case "kartu": st.kartu = p; break;
    case "antrean": st.antrean = p; break;
    case "petugas": st.petugas = p.prioritas; break;
    case "lampu": st.lampu[p.target] = p.nyala; break;
  }
  gambar();
};
gambar();
</script></body></html>`;
