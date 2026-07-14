// 監査ログ契約（design-detail 7 章 — 決定 E16）。
// - イベント種別 enum: apps/api（記録）と apps/web（S9 監査ログ画面の絞り込み
//   `?eventType=`）を跨ぐ契約のため shared に置く。DB 側の CHECK 制約
//   （supabase/migrations/20260714000300 の audit_logs_event_type_check）と同一の値集合。
//   値を追加・変更する場合は DB マイグレーションと同時に行うこと。
// - 閲覧 API（GET /audit-logs — 管理者のみ 2.4）のエントリ・クエリ契約もここに置く。
import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

/** 監査イベント種別（design-detail 7.1 のイベント網羅リスト） */
export const auditEventTypeSchema = z.enum([
  "user.login",
  "user.invited",
  "user.role_changed",
  "user.removed",
  "tenant.settings_updated",
  "screening.searched",
  "list.created",
  "list.updated",
  "list.deleted",
  "entry.status_changed",
  "entry.assignee_changed",
  "deep_dive.started",
  "deep_dive.retried",
  "dossier.viewed",
  "message.generated",
  "message.edited",
  "message.copied",
  "template.created",
  "template.updated",
  "template.deleted",
  "pii.deleted",
  "audit_log.viewed",
]);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

/** 監査ログ 1 件（design-detail 7.2 の記録属性。resource 参照は非 FK の ID 値のみ） */
export const auditLogEntrySchema = z.object({
  id: uuidSchema,
  /** システム起因等で不明な場合は null */
  actorUserId: uuidSchema.nullable(),
  eventType: auditEventTypeSchema,
  resourceType: z.string().nullable(),
  resourceId: uuidSchema.nullable(),
  /** PII・外部コンテンツ本文は含まれない（7.2 — 参照 ID・件数のみ） */
  metadata: z.record(z.string(), z.unknown()),
  requestId: z.string().nullable(),
  occurredAt: isoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** GET /audit-logs の絞り込み（`?eventType=&actorUserId=&from=&to=` — 2.2。ページネーション併用） */
export const auditLogsQuerySchema = z.object({
  eventType: auditEventTypeSchema.optional(),
  actorUserId: uuidSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
