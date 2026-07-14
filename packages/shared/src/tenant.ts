// テナント設定 API 契約（design-detail 2.2 GET/PATCH /tenant — 管理者のみ 2.4）。
// serviceSummary は自社サービス概要: ドシエ分析・メッセージ生成の信頼済みパラメータ
// （design-detail 3.4。DB: tenants.service_summary — 20260714000700）。
import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";
import { tenantStatusSchema } from "./enums.js";

export const tenantSettingsSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  /** 自社サービス概要（未設定は空文字。設定を促す表示は web 側の責務） */
  serviceSummary: z.string(),
  status: tenantStatusSchema,
  createdAt: isoDateTimeSchema,
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

/** PATCH /tenant（少なくとも 1 項目必須） */
export const updateTenantRequestSchema = z
  .object({
    name: z.string().min(1, { error: "テナント名は必須です" }).optional(),
    serviceSummary: z.string().optional(),
  })
  .refine((value) => value.name !== undefined || value.serviceSummary !== undefined, {
    error: "変更する項目を 1 つ以上指定してください",
  });
export type UpdateTenantRequest = z.infer<typeof updateTenantRequestSchema>;
