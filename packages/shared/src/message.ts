// メッセージ生成 API 契約（design-detail 2.3 — 要件 F4 / F5）。
import { z } from "zod";
import { jobErrorSchema } from "./api-error.js";
import { isoDateTimeSchema, uuidSchema } from "./common.js";
import { messageJobStateSchema, warningCodeSchema } from "./enums.js";

/** 出力検証 V2〜V6 の警告（design-detail 3.5） */
export const generationWarningSchema = z.object({
  code: warningCodeSchema,
  detail: z.string(),
});
export type GenerationWarning = z.infer<typeof generationWarningSchema>;

/** テンプレートを指定して生成ジョブ投入 */
export const generateMessageRequestSchema = z.object({
  templateId: uuidSchema,
});
export type GenerateMessageRequest = z.infer<typeof generateMessageRequestSchema>;

/** 202 Accepted のレスポンス */
export const generateMessageResponseSchema = z.object({
  jobId: uuidSchema,
});
export type GenerateMessageResponse = z.infer<typeof generateMessageResponseSchema>;

export const messageJobSchema = z
  .object({
    id: uuidSchema,
    listEntryId: uuidSchema,
    state: messageJobStateSchema,
    /** done 時に設定（superRefine で相関を強制） */
    messageId: uuidSchema.nullable(),
    /** failed 時のみ設定（superRefine で相関を強制） */
    error: jobErrorSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((job, ctx) => {
    // design-detail 2.3: messageId は「done 時に設定」・error は failed 時のみ
    if (job.state === "done" && job.messageId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["messageId"],
        message: "state が done の場合は messageId が必須です",
      });
    }
    if (job.state !== "done" && job.messageId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["messageId"],
        message: "messageId を設定できるのは state が done の場合のみです",
      });
    }
    if (job.state === "failed" && job.error === null) {
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "state が failed の場合は error が必須です",
      });
    }
    if (job.state !== "failed" && job.error !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "error を設定できるのは state が failed の場合のみです",
      });
    }
  });
export type MessageJob = z.infer<typeof messageJobSchema>;

export const messageSchema = z.object({
  id: uuidSchema,
  listEntryId: uuidSchema,
  templateId: uuidSchema,
  dossierId: uuidSchema,
  /** basic-design 5: 骨子（機械埋め込み）とパーソナライズ（LLM 生成）の区別を保持する */
  parts: z.object({
    /** LLM 生成（冒頭の接点） */
    hook: z.string(),
    /** LLM 生成（課題への言及） */
    issueMention: z.string(),
    /** Template から機械埋め込み（自社紹介） */
    introduction: z.string(),
    /** Template から機械埋め込み（CTA） */
    cta: z.string(),
  }),
  /** 組み立て済み全文 */
  assembledBody: z.string(),
  /** 人手編集後本文（決定 E3: メンバーも編集可） */
  editedBody: z.string().nullable(),
  /** 出力検証結果（design-detail 3.5） */
  validation: z.object({
    ok: z.boolean(),
    warnings: z.array(generationWarningSchema),
  }),
  modelId: z.string().min(1),
  generatedAt: isoDateTimeSchema,
  editedAt: isoDateTimeSchema.nullable(),
});
export type Message = z.infer<typeof messageSchema>;
