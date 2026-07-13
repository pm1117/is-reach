// スクリーニング API 契約（design-detail 2.3 — 要件 F1）。
import { z } from "zod";
import { httpUrlSchema, isoDateTimeSchema, uuidSchema } from "./common.js";
import { signalKindSchema } from "./enums.js";

/** 条件検索リクエスト。limit は既定 200・最大 500（要件 F1: 100〜500 社規模） */
export const screeningSearchRequestSchema = z.object({
  attributes: z
    .object({
      industries: z.array(z.string().min(1)).optional(),
      /** 従業員規模の区分コード（facets で提供） */
      employeeRanges: z.array(z.string().min(1)).optional(),
      regions: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  signals: z
    .object({
      kinds: z.array(signalKindSchema).optional(),
      keywords: z.array(z.string().min(1)).optional(),
      /** シグナル鮮度（日数） */
      freshWithinDays: z
        .number()
        .int({ error: "freshWithinDays は整数で指定してください" })
        .min(1, { error: "freshWithinDays は 1 以上で指定してください" })
        .optional(),
    })
    .optional(),
  // JSON ボディで受けるため coerce しない（クエリ文字列由来の pagination とは異なる）
  limit: z
    .number()
    .int({ error: "limit は整数で指定してください" })
    .min(1, { error: "limit は 1 以上で指定してください" })
    .max(500, { error: "limit は最大 500 です" })
    .default(200),
});
export type ScreeningSearchRequest = z.infer<typeof screeningSearchRequestSchema>;
export type ScreeningSearchRequestInput = z.input<typeof screeningSearchRequestSchema>;

/** マッチ根拠（要件 F1 受け入れ条件 2: 検索結果には必ず根拠が付く） */
export const matchedSignalSchema = z.object({
  signalId: uuidSchema,
  kind: signalKindSchema,
  summary: z.string(),
  sourceUrl: httpUrlSchema,
  collectedAt: isoDateTimeSchema,
});
export type MatchedSignal = z.infer<typeof matchedSignalSchema>;

export const screeningSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      company: z.object({
        id: uuidSchema,
        name: z.string().min(1),
        domain: z.string().nullable(),
        industry: z.string().nullable(),
        employeeRange: z.string().nullable(),
        region: z.string().nullable(),
      }),
      /** ルールベーススコア（LLM 不使用 — 要件 F1） */
      score: z.number(),
      matchedSignals: z.array(matchedSignalSchema),
    }),
  ),
  total: z.number().int().min(0),
});
export type ScreeningSearchResponse = z.infer<typeof screeningSearchResponseSchema>;
