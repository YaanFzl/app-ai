/**
 * Klien native Jev (System One) lewat gateway Experiential Labs. Satu-satunya tempat panggilan HTTP ke Jev.
 *  - POST hanya ke JEV_URL; kunci Bearer hanya dari EXPERIENTIAL_API_KEY (tidak pernah dicatat).
 *  - Batas waktu tegas; TANPA percobaan ulang dan tanpa Idempotency-Key: hasil yang tidak diketahui
 *    mungkin sudah ditagih. Galat HTTP / transport dilempar apa adanya; penilai berikutnya yang mengambil alih.
 *  - Pertanyaan dalam satu permintaan independen (jawaban satu tidak menjadi masukan yang lain).
 *  - Keyakinan dan probabilitas bukan jaminan benar; keputusan akhir tetap di mesin dan petugas.
 */
import { z } from "zod";

export const JEV_URL = "https://api.experientiallabs.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
/** Batas penerimaan gateway (bukan batas penyedia). */
export const BATAS_JEV = { pertanyaan: 32, opsiChoice: 64 } as const;

export type PertanyaanJev =
  | { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }
  | { readonly type: "noul"; readonly instructions: string; readonly criteria?: { readonly true?: string; readonly false?: string } };
// ponytail: tipe "score" belum dipakai kios; tambahkan beserta skema jawabannya saat ada pertanyaan berjenjang.

const JawabanSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number().min(0).max(1) }),
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
]);
const ResponsSchema = z.object({
  model: z.string(),
  answers: z.record(JawabanSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});
export type ResponsJev = z.infer<typeof ResponsSchema>;

export class GalatJev extends Error {
  override name = "GalatJev";
}

export interface KlienJev {
  panggil(state: unknown, questions: Readonly<Record<string, PertanyaanJev>>): Promise<ResponsJev>;
}

export function buatKlienJev(o: { kunci: string; batasWaktuMs: number; model?: string; fetch?: typeof fetch }): KlienJev {
  const ambil = o.fetch ?? fetch;
  return {
    async panggil(state, questions) {
      const ids = Object.keys(questions);
      if (ids.length === 0 || ids.length > BATAS_JEV.pertanyaan) throw new GalatJev(`jumlah pertanyaan ${ids.length} di luar 1..${BATAS_JEV.pertanyaan}`);
      for (const [id, q] of Object.entries(questions)) {
        if (q.type === "choice" && Object.keys(q.criteria).length > BATAS_JEV.opsiChoice) throw new GalatJev(`${id}: opsi lebih dari ${BATAS_JEV.opsiChoice}`);
      }
      let res: Response;
      try {
        res = await ambil(JEV_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${o.kunci}`, "content-type": "application/json" },
          body: JSON.stringify({ model: o.model ?? JEV_MODEL, state, questions }),
          signal: AbortSignal.timeout(o.batasWaktuMs),
        });
      } catch (e) {
        const habis = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new GalatJev(habis ? `batas waktu ${o.batasWaktuMs} ms habis` : `transport: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) throw new GalatJev(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const r = ResponsSchema.safeParse(await res.json().catch(() => null));
      if (!r.success) throw new GalatJev(`respons tidak sesuai skema: ${r.error.issues[0]?.message ?? "?"}`);
      for (const id of ids) if (!r.data.answers[id]) throw new GalatJev(`jawaban "${id}" tidak ada`);
      return r.data;
    },
  };
}

/** `null` bila EXPERIENTIAL_API_KEY tidak ada: Jev dilewati, kios tetap jalan lewat Claude / kata kunci. */
export function klienJevDariEnv(env: NodeJS.ProcessEnv = process.env): KlienJev | null {
  const kunci = env.EXPERIENTIAL_API_KEY;
  if (!kunci) return null;
  return buatKlienJev({ kunci, batasWaktuMs: Number(env.JEV_BATAS_WAKTU_MS ?? 3000) });
}
