// ドシエ契約（design-detail 2.3 — 要件 F3: 根拠なしを明示できる判別可能な型）。
import { z } from "zod";
import { httpUrlSchema, isoDateTimeSchema, uuidSchema } from "./common.js";
import { generationWarningSchema } from "./message.js";

/**
 * 根拠の判別可能ユニオン。
 * - `sources`: 出典 URL 1 件以上必須（空配列は型検査で拒否 — basic-design 8.2）
 * - `none`: 「根拠なし」の明示（捏造ではなく根拠なしと出力する — 要件 F3 受け入れ条件 2）
 */
export const evidenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sources"),
    urls: z.array(httpUrlSchema).min(1, { error: "出典 URL は 1 件以上必要です" }),
  }),
  z.object({
    kind: z.literal("none"),
  }),
]);
export type Evidence = z.infer<typeof evidenceSchema>;

export const dossierSectionSchema = z.object({
  body: z.string(),
  evidence: evidenceSchema,
});
export type DossierSection = z.infer<typeof dossierSectionSchema>;

export const dossierSchema = z.object({
  id: uuidSchema,
  listEntryId: uuidSchema,
  businessSummary: dossierSectionSchema,
  /** 推定課題 */
  inferredIssues: z.array(dossierSectionSchema),
  /** 自社サービスとの接続点 */
  serviceHooks: z.array(dossierSectionSchema),
  /** 収集ソース一覧（V6 の根拠 URL 出所検証の対象） */
  sources: z.array(
    z.object({
      url: httpUrlSchema,
      fetchedAt: isoDateTimeSchema,
      title: z.string().nullable(),
    }),
  ),
  /** 出力検証の警告（design-detail 3.5） */
  warnings: z.array(generationWarningSchema),
  /** 生成に使ったモデル（決定 E2） */
  modelId: z.string().min(1),
  generatedAt: isoDateTimeSchema,
});
export type Dossier = z.infer<typeof dossierSchema>;
