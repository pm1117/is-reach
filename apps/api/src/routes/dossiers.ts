// ドシエ閲覧（design-detail 2.2 — 要件 F3）。閲覧は監査ログ対象（dossier.viewed — 7.1）。
import { dossierSchema, type Dossier } from "@is-reach/shared";
import type { Hono } from "hono";
import { recordAuditEvent } from "../audit/audit-log.js";
import { ApiHttpError } from "../errors.js";
import { registerRoute } from "../middleware/authorize.js";
import type { AppEnv } from "../types.js";
import { parseDbContract, parseUuidParam, toIso } from "../validation.js";
import { resolveActor, type RouteDeps } from "./deps.js";

interface DossierRow {
  id: string;
  list_entry_id: string;
  business_summary: unknown;
  inferred_issues: unknown;
  service_hooks: unknown;
  sources: unknown;
  warnings: unknown;
  model_id: string;
  generated_at: Date | string;
}

export function toDossier(row: DossierRow): Dossier {
  return parseDbContract(
    dossierSchema,
    {
      id: row.id,
      listEntryId: row.list_entry_id,
      businessSummary: row.business_summary,
      inferredIssues: row.inferred_issues,
      serviceHooks: row.service_hooks,
      sources: row.sources,
      warnings: row.warnings,
      modelId: row.model_id,
      generatedAt: toIso(row.generated_at),
    },
    "dossiers 行",
  );
}

export function registerDossierRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "GET", "/entries/:entryId/dossier", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const entryId = parseUuidParam(c, "entryId");

    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const result = await tx.query<DossierRow>(
        `select id, list_entry_id, business_summary, inferred_issues, service_hooks,
                sources, warnings, model_id, generated_at
           from dossiers where list_entry_id = $1`,
        [entryId],
      );
      const dossier = result.rows[0];
      if (dossier === undefined) return undefined;
      // 閲覧自体を記録（dossier.viewed — 7.1）
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "dossier.viewed",
        resourceType: "Dossier",
        resourceId: dossier.id,
        metadata: { listEntryId: entryId },
        requestId,
      });
      return dossier;
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "ドシエが見つかりません");
    }
    return c.json(toDossier(row));
  });
}
