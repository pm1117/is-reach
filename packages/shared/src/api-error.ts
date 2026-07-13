// エラーレスポンス標準形（design-detail 2.5 — 決定）。
import { z } from "zod";
import { errorCodeSchema } from "./enums.js";

/** すべての API エラーはこの形で返す */
export const apiErrorSchema = z.object({
  error: z.object({
    /** 機械判読用コード */
    code: errorCodeSchema,
    /** 人間可読メッセージ（日本語） */
    message: z.string().min(1),
    /** 例: バリデーション失敗フィールドの詳細 */
    details: z.record(z.string(), z.unknown()).optional(),
    /** ログ相関用 */
    requestId: z.string().min(1),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** ジョブの error フィールド（DeepDiveJob.error / MessageJob.error — 2.5 と同じコード体系） */
export const jobErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
});
export type JobError = z.infer<typeof jobErrorSchema>;
