// 企業リスト API 契約（design-detail 2.3 — 要件 F1 / F5）。
import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";
import { entryStatusSchema } from "./enums.js";
import { matchedSignalSchema, screeningSearchRequestSchema } from "./screening.js";

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

/** 企業リスト（GET /lists / GET /lists/:listId のレスポンス。2.3 に明示定義がないため本 PR で確定） */
export const companyListSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  /** 検索条件スナップショット（要件 F1 受け入れ条件 1） */
  searchCondition: screeningSearchRequestSchema,
  /** 作成者（ユーザー削除後は null — DB: ON DELETE SET NULL） */
  createdBy: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type CompanyList = z.infer<typeof companyListSchema>;

/** PATCH /lists/:listId（リスト名変更 — 2.2） */
export const updateListRequestSchema = z.object({
  name: z.string().min(1, { error: "リスト名は必須です" }),
});
export type UpdateListRequest = z.infer<typeof updateListRequestSchema>;

/** リストエントリ（GET /lists/:listId/entries の要素。企業の表示属性を同梱する） */
export const listEntrySchema = z.object({
  id: uuidSchema,
  companyListId: uuidSchema,
  company: z.object({
    id: uuidSchema,
    name: z.string().min(1),
    domain: z.string().nullable(),
    industry: z.string().nullable(),
    employeeRange: z.string().nullable(),
    region: z.string().nullable(),
  }),
  /** マッチ根拠（要件 F1 受け入れ条件 2） */
  matchEvidence: z.array(matchedSignalSchema),
  status: entryStatusSchema,
  assigneeId: uuidSchema.nullable(),
  /** 最新の深掘りジョブ参照（design-detail 4.1。未実行は null） */
  latestDeepDiveJobId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ListEntry = z.infer<typeof listEntrySchema>;

/** GET /lists/:listId/entries の絞り込み（要件 F5。ページネーションは共通契約と併用） */
export const listEntriesQuerySchema = z.object({
  status: entryStatusSchema.optional(),
  assigneeId: uuidSchema.optional(),
});
export type ListEntriesQuery = z.infer<typeof listEntriesQuerySchema>;

/** PATCH /entries/:entryId（ステータス・担当者の更新 — 要件 F5。少なくとも 1 項目必須） */
export const updateListEntryRequestSchema = z
  .object({
    status: entryStatusSchema.optional(),
    /** null = 担当者解除 */
    assigneeId: uuidSchema.nullable().optional(),
  })
  .refine((value) => value.status !== undefined || value.assigneeId !== undefined, {
    error: "status または assigneeId のいずれかを指定してください",
  });
export type UpdateListEntryRequest = z.infer<typeof updateListEntryRequestSchema>;
