// GET /api/v1/me のレスポンス契約（design-detail 2.2「認証・自身」）。
// design-detail 2.3 に明示の型定義はないが、API 契約は shared が唯一の置き場（E5/E17）の
// ため本ファイルで確定する（apps/web が PR6 で同じ契約を使う）。
import { z } from "zod";
import { uuidSchema } from "./common.js";
import { roleSchema } from "./enums.js";

/** 自ユーザー・所属テナント・ロール（認証済み全員が取得可能 — design-detail 2.4） */
export const meResponseSchema = z.object({
  user: z.object({
    id: uuidSchema,
    email: z.email({ error: "メールアドレス形式ではありません" }),
    displayName: z.string().nullable(),
    role: roleSchema,
  }),
  tenant: z.object({
    id: uuidSchema,
    name: z.string().min(1),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
