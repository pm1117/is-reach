// ユーザー管理 API 契約（design-detail 2.2「ユーザー・テナント管理」— 要件 F6）。
// 2.3 に明示定義がないため本 PR で確定する（apps/web の S8 設定画面が同じ契約を使う）。
import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";
import { invitationStatusSchema, roleSchema } from "./enums.js";

/** テナント内ユーザー（GET /users の要素。担当者アサイン UI に必要なため全員可 — 2.2） */
export const tenantUserSchema = z.object({
  id: uuidSchema,
  email: z.email({ error: "メールアドレス形式ではありません" }),
  displayName: z.string().nullable(),
  role: roleSchema,
  invitationStatus: invitationStatusSchema,
  createdAt: isoDateTimeSchema,
});
export type TenantUser = z.infer<typeof tenantUserSchema>;

/** POST /users/invitations（招待 — 管理者のみ。Supabase Auth の招待機能を利用 — E1） */
export const inviteUserRequestSchema = z.object({
  email: z.email({ error: "メールアドレス形式ではありません" }),
  role: roleSchema,
});
export type InviteUserRequest = z.infer<typeof inviteUserRequestSchema>;

/** PATCH /users/:userId（ロール変更 — 管理者のみ） */
export const updateUserRoleRequestSchema = z.object({
  role: roleSchema,
});
export type UpdateUserRoleRequest = z.infer<typeof updateUserRoleRequestSchema>;
