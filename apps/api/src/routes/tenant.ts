// テナント設定（design-detail 2.2 GET/PATCH /tenant — 管理者のみ 2.4）。
// serviceSummary はドシエ分析・メッセージ生成の信頼済みパラメータ（3.4）の供給元。
import {
  tenantSettingsSchema,
  updateTenantRequestSchema,
  type TenantSettings,
} from "@is-reach/shared";
import type { Hono } from "hono";
import { recordAuditEvent } from "../audit/audit-log.js";
import { ApiHttpError } from "../errors.js";
import { registerRoute } from "../middleware/authorize.js";
import type { AppEnv } from "../types.js";
import { parseDbContract, parseJsonBody, toIso } from "../validation.js";
import { resolveActor, type RouteDeps } from "./deps.js";

interface TenantRow {
  id: string;
  name: string;
  service_summary: string;
  status: string;
  created_at: Date | string;
}

const TENANT_SELECT = `select id, name, service_summary, status, created_at from tenants`;

function toTenantSettings(row: TenantRow): TenantSettings {
  return parseDbContract(
    tenantSettingsSchema,
    {
      id: row.id,
      name: row.name,
      serviceSummary: row.service_summary,
      status: row.status,
      createdAt: toIso(row.created_at),
    },
    "tenants 行",
  );
}

export function registerTenantRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "GET", "/tenant", async (c) => {
    const auth = c.get("auth");
    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      // RLS（tenants は id = app.tenant_id）で自テナント行のみ可視
      const result = await tx.query<TenantRow>(`${TENANT_SELECT} where id = $1`, [auth.tenantId]);
      return result.rows[0];
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "テナントが見つかりません");
    }
    return c.json(toTenantSettings(row));
  });

  registerRoute(v1, "PATCH", "/tenant", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const body = await parseJsonBody(c, updateTenantRequestSchema);
    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const updated = await tx.query<TenantRow>(
        `update tenants
            set name = coalesce($2, name),
                service_summary = coalesce($3, service_summary)
          where id = $1
          returning id, name, service_summary, status, created_at`,
        [auth.tenantId, body.name ?? null, body.serviceSummary ?? null],
      );
      const tenant = updated.rows[0];
      if (tenant === undefined) return undefined;
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "tenant.settings_updated",
        resourceType: "Tenant",
        resourceId: auth.tenantId,
        metadata: { updatedFields: Object.keys(body) },
        requestId,
      });
      return tenant;
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "テナントが見つかりません");
    }
    return c.json(toTenantSettings(row));
  });
}
