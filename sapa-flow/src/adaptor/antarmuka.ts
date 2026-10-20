/**
 * Antarmuka adaptor perangkat kios. Mesin tidak mengenal perangkat: adaptor masukan hanya bisa
 * memancarkan subset peristiwa miliknya (dikunci tipe), adaptor keluaran hanya menerima efek miliknya.
 * Penghubung ke runner ada di `pengemudi.ts`. Implementasi palsu: `src/mock/adaptor-palsu.ts`.
 */
import type { DokumenOcr, HasilFrista, HasilSidikJari, Pribadi } from "../domain.js";
import type { Efek } from "../mesin.js";
import type { PeristiwaMentah } from "../sesi.js";
import type { Giliran } from "../ucapan.js";

type Pendengar<T> = (cb: (x: T) => void) => void;

// ---------------------------------------------------------------- masukan
/** STT hanya menghasilkan transkrip final; pemahaman dan penyamaran tetap di runner. */
export type PeristiwaStt = Extract<PeristiwaMentah, { tipe: "UCAPAN_PASIEN" }>;
export interface Stt {
  readonly dengar: Pendengar<PeristiwaStt>;
}

/** Bacaan mentah pemindai (OCR). Kartu/booking diperkaya pengemudi lewat VClaim + SIMRS sebelum masuk mesin. */
export type BacaanPemindai =
  | { readonly jenis: "kartu"; readonly sumber: "kartu_jkn" | "ktp"; readonly nik?: string; readonly nomorKartu?: string }
  | { readonly jenis: "booking"; readonly kodeBooking: string }
  | { readonly jenis: "dokumen"; readonly dokumen: DokumenOcr }
  | { readonly jenis: "gagal"; readonly sasaran: "kartu" | "booking" | "dokumen" };
export interface Pemindai {
  readonly dengar: Pendengar<BacaanPemindai>;
  lampu(nyala: boolean): void;
}

/** Satu-satunya batas biometrik (FRISTA wajah dan sidik jari). Dipanggil pengemudi saat mesin masuk keadaan verifikasi. */
export interface VerifikasiBiometrik {
  wajah(nik: Pribadi<"NIK">, percobaan: number): Promise<HasilFrista>;
  sidikJari(nik: Pribadi<"NIK">, percobaan: number): Promise<HasilSidikJari>;
}

// ---------------------------------------------------------------- keluaran
/** Hanya `Giliran` (berisi `Ucapan` bermerek): string bebas, nama, atau NIK tidak bisa diucapkan. */
export interface Tts {
  putar(g: Giliran): Promise<void>;
}

export type AksiKamera = Extract<Efek, { efek: "kamera" }>["aksi"];
export interface Kamera {
  atur(aksi: AksiKamera): void;
  lampu(nyala: boolean): void;
}

export interface PrinterAntrean {
  cetak(e: Extract<Efek, { efek: "cetak_antrean" }>): Promise<void>;
}

export interface Adaptor {
  readonly stt: Stt;
  readonly pemindai: Pemindai;
  readonly biometrik: VerifikasiBiometrik;
  readonly tts: Tts;
  readonly kamera: Kamera;
  readonly printer: PrinterAntrean;
}
