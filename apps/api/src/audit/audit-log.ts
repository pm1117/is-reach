// 監査ログ記録（design-detail 7 章 — 決定 E16）。
// - withTenantContext のトランザクション内（app_user 経路）で INSERT する。
//   業務書き込みと同一トランザクションに含めれば原子的に記録される。
// - 追記専用は DB 権限で担保（app_user は INSERT / SELECT のみ — 20260714000400）。
// - metadata に PII・外部コンテンツ本文を入れないこと（7.2 — 参照 ID・件数のみ）。
import { auditEventTypeSchema, uuidSchema } from "@is-reach/shared";
import { z } from "zod";
import type { TenantQuerier } from "../db/tenant-db.js";

/** 記録属性（design-detail 7.2）。resource_id は非 FK（削除後もログが残る — 6.1） */
export const auditEventInputSchema = z.object({
  tenantId: uuidSchema,
  /** 実行ユーザー（users.id）。システム起因イベントはジョブ起動ユーザーを引き継ぐ（7.2） */
  actorUserId: uuidSchema.nullable(),
  eventType: auditEventTypeSchema,
  resourceType: z.string().min(1).nullable().default(null),
  resourceId: uuidSchema.nullable().default(null),
  /** PII・外部コンテンツ本文は入れない（7.2）。値の中身は呼び出し側の責務 */
  metadata: z.record(z.string(), z.unknown()).default({}),
  /** API の requestId と相関（2.5）。バッチ等リクエスト起点でない場合は null */
  requestId: z.string().min(1).nullable().default(null),
});
export type AuditEventInput = z.input<typeof auditEventInputSchema>;

/**
 * 監査イベントを 1 件記録する。tx は withTenantContext() が渡す TenantQuerier
 * （tenant_id は RLS の WITH CHECK でも突合されるため、コンテキスト外テナントの
 * 記録は DB 側で拒否される）。
 */
export async function recordAuditEvent(tx: TenantQuerier, event: AuditEventInput): Promise<void> {
  const parsed = auditEventInputSchema.parse(event);
  await tx.query(
    `insert into audit_logs
       (tenant_id, actor_user_id, event_type, resource_type, resource_id, metadata, request_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      parsed.tenantId,
      parsed.actorUserId,
      parsed.eventType,
      parsed.resourceType,
      parsed.resourceId,
      JSON.stringify(parsed.metadata),
      parsed.requestId,
    ],
  );
}
