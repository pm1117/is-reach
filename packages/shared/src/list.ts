// 企業リスト API 契約（design-detail 2.3 — 要件 F1 / F5）。
import { z } from "zod";
import { uuidSchema } from "./common.js";
import { screeningSearchRequestSchema } from "./screening.js";

/** 検索条件スナップショット + 検索結果からのリスト作成 */
export const createListRequestSchema = z.object({
  name: z.string().min(1, { error: "リスト名は必須です" }),
  /** 条件スナップショット */
  searchCondition: screeningSearchRequestSchema,
  /** 検索結果からユーザーが採用した企業（1 件以上） */
  companyIds: z.array(uuidSchema).min(1, { error: "企業を 1 件以上指定してください" }),
});
export type CreateListRequest = z.infer<typeof createListRequestSchema>;
export type CreateListRequestInput = z.input<typeof createListRequestSchema>;
