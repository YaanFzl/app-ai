/**
 * Uji layar kios di browser asli (Playwright + Chrome/Edge yang sudah terpasang). `npm run uji:layar`.
 * Matriks: potret 1080×1920 dan lanskap 1920×1080, masing-masing zoom 100% dan 200%
 * (zoom 200% = viewport CSS separuh dengan deviceScaleFactor 2, sama seperti zoom browser).
 * Bukti tangkapan layar: bukti/layar/<konfigurasi>-<layar>.png
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import { jalankanKiosDemo } from "../src/mock/kios-demo.js";
import { HARI_INI, KARTU_SITI } from "./palsu.js";

const BUKTI = "bukti/layar";
const KONFIGURASI = [
  { nama: "potret-100", lebar: 1080, tinggi: 1920, zoom: 1 },
  { nama: "potret-200", lebar: 1080, tinggi: 1920, zoom: 2 },
  { nama: "lanskap-100", lebar: 1920, tinggi: 1080, zoom: 1 },
  { nama: "lanskap-200", lebar: 1920, tinggi: 1080, zoom: 2 },
] as const;
/** NIK dan nomor kartu dummy di server mock; tidak satu pun boleh ada utuh di DOM. */
const NOMOR_PRIBADI = [KARTU_SITI.nik, "0001234567890", "3273010202480002", "0001234567891"];

let browser: Browser;
before(async () => {
  mkdirSync(BUKTI, { recursive: true });
  const coba = async (channel: "chrome" | "msedge") => chromium.launch({ channel }).catch(() => null);
  const b = (await coba("chrome")) ?? (await coba("msedge"));
  assert.ok(b, "Chrome atau Edge tidak ditemukan; uji layar butuh salah satunya");
  browser = b;
});
after(() => browser?.close());

/** tsx (esbuild keepNames) menyuntik `__name(...)` ke fungsi di callback `page.evaluate`; browser tidak punya helper itu. */
async function konteks(o: Parameters<Browser["newContext"]>[0]) {
  const c = await browser.newContext(o);
  await c.addInitScript("globalThis.__name = (f) => f;");
  return c;
}

/** Pemeriksaan tata letak dan privasi untuk layar yang sedang tampil. */
async function periksa(page: Page, konteks: string) {
  const r = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const tombol = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
    const masalah: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) masalah.push(`gulir horizontal: ${document.documentElement.scrollWidth} > ${vw}`);
    for (const b of tombol) {
      const k = b.getBoundingClientRect();
      if (k.height < 64 || k.width < 64) masalah.push(`target sentuh kecil "${b.textContent}": ${Math.round(k.width)}×${Math.round(k.height)}`);
      if (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1) masalah.push(`teks terpotong "${b.textContent}"`);
    }
    for (const id of ["ulangi", "petugas"]) {
      const k = document.getElementById(id)!.getBoundingClientRect();
      if (k.top < 0 || k.bottom > vh + 1 || k.left < 0 || k.right > vw + 1) masalah.push(`tombol ${id} keluar layar`);
    }
    const terlihat = (e: Element) => {
      const k = e.getBoundingClientRect();
      return k.top >= -1 && k.left >= -1 && k.bottom <= vh + 1 && k.right <= vw + 1;
    };
    /** Benar-benar tampak: di dalam viewport DAN tidak tertutup elemen lain (footer, tombol sticky, batas gulir). */
    const tampak = (e: Element) => {
      if (!terlihat(e)) return false;
      const k = e.getBoundingClientRect();
      for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.15], [0.9, 0.85]] as const) {
        const atas = document.elementFromPoint(k.left + k.width * fx, k.top + k.height * fy);
        if (!atas || !(e === atas || e.contains(atas) || atas.contains(e))) return false;
      }
      return true;
    };
    // Tanpa menggulir: pertanyaan, tombol jawaban, ringkasan data, dan nomor antrean harus tampak utuh.
    const wajib = "#subtitle, [data-opsi], [data-aksi], .kartu dt, .kartu dd, .antrean .nomor, .antrean .arah, .petugas";
    for (const e of document.querySelectorAll(wajib)) if (!tampak(e)) masalah.push(`"${(e.textContent ?? "").slice(0, 30)}" tertutup / di luar layar`);
    // Nilai kartu (mis. NIK tersamar) tidak dipatah di tengah kata.
    for (const dd of document.querySelectorAll(".kartu dd")) {
      const teks = dd.firstChild;
      if (teks && !/\s/.test(teks.textContent ?? "")) {
        const r = document.createRange();
        r.selectNodeContents(teks);
        if (new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1) masalah.push(`nilai "${teks.textContent}" terpatah`);
      }
    }
    const sub = document.getElementById("subtitle")!;
    const ukuran = parseFloat(getComputedStyle(sub).fontSize);
    if (ukuran < 48) masalah.push(`subtitle ${ukuran}px < 48px`);
    if (sub.scrollWidth > sub.clientWidth + 1) masalah.push("subtitle terpotong");
    return { masalah, html: document.documentElement.outerHTML, teks: document.body.innerText };
  });
  assert.deepEqual(r.masalah, [], `${konteks}: ${r.masalah.join("; ")}`);
  // Privasi: DOM tidak pernah memuat NIK / nomor kartu lengkap (juga tidak di atribut atau skrip).
  for (const n of NOMOR_PRIBADI) assert.ok(!r.html.includes(n), `${konteks}: DOM memuat nomor pribadi utuh`);
  assert.ok(!/\d{13,}/.test(r.teks), `${konteks}: teks layar memuat deret 13+ digit`);
}

async function foto(page: Page, nama: string) {
  await page.screenshot({ path: `${BUKTI}/${nama}.png` });
}

for (const k of KONFIGURASI) {
  test(`layar kios ${k.nama}: alur BPJS lewat ketukan, tata letak rapi, NIK tersamar`, async () => {
    const demo = await jalankanKiosDemo({ hariIni: HARI_INI, jedaPetugasMs: 300 });
    await new Promise<void>((r) => demo.layar.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(demo.layar.server.address() as AddressInfo).port}`;
    const ctx = await konteks({ viewport: { width: k.lebar / k.zoom, height: k.tinggi / k.zoom }, deviceScaleFactor: k.zoom, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await page.goto(base);
      await page.waitForSelector('[data-aksi="mulai"]');
      await periksa(page, `${k.nama} siaga`);
      await foto(page, `${k.nama}-1-siaga`);

      await page.click('[data-aksi="mulai"]');
      await page.waitForSelector('[data-opsi="bpjs"]');
      await periksa(page, `${k.nama} mode`);
      await foto(page, `${k.nama}-2-mode`);

      await page.click('[data-opsi="bpjs"]');
      await page.waitForSelector('[data-opsi="ya"]');
      await periksa(page, `${k.nama} izin`);
      await foto(page, `${k.nama}-3-izin`);

      await page.click('[data-opsi="ya"]');
      await page.waitForSelector('[data-opsi="kontrol"]'); // kartu + wajah dipalsukan panel
      await page.click('[data-opsi="kontrol"]');
      await page.waitForSelector(".kartu");
      await page.waitForSelector('[data-opsi="ya"]');
      await periksa(page, `${k.nama} konfirmasi`);
      const kartu = await page.locator(".kartu").innerText();
      assert.match(kartu, /Siti Aminah/);
      assert.match(kartu, /\*{12}0001/, "NIK tersamar 4 digit terakhir");
      assert.match(kartu, /penyakit dalam/i);
      await foto(page, `${k.nama}-4-konfirmasi`);

      await page.click('[data-opsi="ya"]');
      await page.waitForSelector(".antrean");
      await periksa(page, `${k.nama} antrean`);
      assert.match(await page.locator(".antrean").innerText(), /PD-001[\s\S]*Silakan ke poli/);
      await foto(page, `${k.nama}-5-antrean`);

      // Sesi kedua: Panggil Petugas dari layar; kios terkunci sampai petugas selesai.
      await page.click('[data-aksi="mulai"]');
      await page.waitForSelector('[data-opsi="bpjs"]');
      await page.click("#petugas");
      await page.waitForSelector(".petugas");
      await periksa(page, `${k.nama} petugas`);
      assert.equal(demo.kios.mulaiSesi(), null);
      await foto(page, `${k.nama}-6-petugas`);
    } finally {
      await ctx.close();
      demo.layar.server.closeAllConnections();
      demo.layar.server.close();
      demo.tutup();
    }
  });
}

test("avatar cadangan frame PNG (browser tanpa VP9 alpha) tampil dan beranimasi", async () => {
  const demo = await jalankanKiosDemo({ hariIni: HARI_INI });
  await new Promise<void>((r) => demo.layar.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(demo.layar.server.address() as AddressInfo).port}`;
  const ctx = await konteks({ viewport: { width: 1080, height: 1920 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/?avatar=png`);
    await page.waitForSelector("#avatar img");
    assert.equal(await page.getAttribute("#avatar", "data-mode"), "png");
    const awal = await page.getAttribute("#avatar img", "src");
    // Beranimasi: src berganti, dan frame yang sedang tampil sudah termuat (tidak kosong / berkedip).
    await page.waitForFunction((a) => document.querySelector("#avatar img")?.getAttribute("src") !== a, awal);
    for (let n = 0; n < 5; n++) {
      assert.ok(await page.evaluate(() => { const i = document.querySelector("#avatar img") as HTMLImageElement; return i.complete && i.naturalWidth > 0; }), "frame PNG tampil kosong");
      await page.waitForTimeout(37);
    }
    await page.goto(base);
    assert.equal(await page.getAttribute("#avatar", "data-mode"), "webm");
    await page.screenshot({ path: `${BUKTI}/avatar-png-cadangan.png` });
  } finally {
    await ctx.close();
    demo.layar.server.closeAllConnections();
    demo.layar.server.close();
    demo.tutup();
  }
});
