// 監査ログ閲覧（design-detail 2.2 GET /audit-logs — 管理者のみ 2.4 / 決定 E16）。
// 管理者の閲覧自体も audit_log.viewed として記録する（7.1）。
import {
  auditLogEntrySchema,
  auditLogsQuerySchema,
  paginationQuerySchema,
  type AuditLogEntry,
} from "@is-reach/shared";
import type { Hono } from "hono";
import { recordAuditEvent } from "../audit/audit-log.js";
import { registerRoute } from "../middleware/authorize.js";
import type { AppEnv } from "../types.js";
import { parseDbContract, parseQuery, toIso } from "../validation.js";
import { resolveActor, type RouteDeps } from "./deps.js";

interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: unknown;
  request_id: string | null;
  occurred_at: Date | string;
}

function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return parseDbContract(
    auditLogEntrySchema,
    {
      id: row.id,
      actorUserId: row.actor_user_id,
      eventType: row.event_type,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      metadata: row.metadata,
      requestId: row.request_id,
      occurredAt: toIso(row.occurred_at),
    },
    "audit_logs 行",
  );
}

export function registerAuditLogRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "GET", "/audit-logs", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const filter = parseQuery(c, auditLogsQuerySchema);
    const page = parseQuery(c, paginationQuerySchema);

    const result = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const where = `where ($1::text is null or event_type = $1)
            and ($2::uuid is null or actor_user_id = $2)
            and ($3::timestamptz is null or occurred_at >= $3)
            and ($4::timestamptz is null or occurred_at <= $4)`;
      const params = [
        filter.eventType ?? null,
        filter.actorUserId ?? null,
        filter.from ?? null,
        filter.to ?? null,
      ];
      const total = await tx.query<{ n: string }>(
        `select count(*)::text as n from audit_logs ${where}`,
        params,
      );
      const rows = await tx.query<AuditLogRow>(
        `select id, actor_user_id, event_type, resource_type, resource_id, metadata,
                request_id, occurred_at
           from audit_logs ${where}
          order by occurred_at desc, id limit $5 offset $6`,
        [...params, page.limit, page.offset],
      );
      // 監査ログ閲覧自体を記録（audit_log.viewed — 7.1）
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "audit_log.viewed",
        metadata: { filter },
        requestId,
      });
      return {
        items: rows.rows.map(toAuditLogEntry),
        total: Number.parseInt(total.rows[0]?.n ?? "0", 10),
      };
    });
    return c.json(result);
  });
}
