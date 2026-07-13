// PII 削除 API 契約（design-detail 2.3 — 要件 6.3 / 決定 E4: 即時物理削除）。
import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * 削除リクエスト。scope に応じて対象 ID の必須関係を refine で強制する:
 * - `entry`: entryId 必須（companyId は指定不可）
 * - `company`: companyId 必須（entryId は指定不可）
 */
export const deletionRequestSchema = z
  .object({
    /** entry: 単一エントリ / company: テナント内の当該企業の全データ */
    scope: z.enum(["entry", "company"]),
    entryId: uuidSchema.optional(),
    companyId: uuidSchema.optional(),
    /** 依頼の要旨（監査ログに残る — E4: 削除内容そのものは残さない） */
    reason: z.string().min(1, { error: "削除理由は必須です" }),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "entry") {
      if (value.entryId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["entryId"],
          message: "scope が entry の場合は entryId が必須です",
        });
      }
      if (value.companyId !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["companyId"],
          message: "scope が entry の場合は companyId を指定できません",
        });
      }
    }
    if (value.scope === "company") {
      if (value.companyId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["companyId"],
          message: "scope が company の場合は companyId が必須です",
        });
      }
      if (value.entryId !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["entryId"],
          message: "scope が company の場合は entryId を指定できません",
        });
      }
    }
  });
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;

/** カスケード削除の結果件数（ListEntry → Dossier・収集データ・Message — 決定 E4） */
export const deletionResponseSchema = z.object({
  deleted: z.object({
    dossiers: z.number().int().min(0),
    messages: z.number().int().min(0),
    collectedDocuments: z.number().int().min(0),
    entries: z.number().int().min(0),
  }),
});
export type DeletionResponse = z.infer<typeof deletionResponseSchema>;
