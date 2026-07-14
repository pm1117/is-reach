// テンプレート（design-detail 2.2 — 要件 F4 / 決定 E3）。
// 閲覧は全員・変更系（POST/PATCH/DELETE）は管理者のみ（認可は宣言テーブルが強制）。
import {
  createTemplateRequestSchema,
  paginationQuerySchema,
  templateSchema,
  updateTemplateRequestSchema,
  type Template,
} from "@is-reach/shared";
import type { Hono } from "hono";
import { recordAuditEvent } from "../audit/audit-log.js";
import { ApiHttpError } from "../errors.js";
import { registerRoute } from "../middleware/authorize.js";
import type { AppEnv } from "../types.js";
import {
  parseDbContract,
  parseJsonBody,
  parseQuery,
  parseUuidParam,
  toIso,
} from "../validation.js";
import { resolveActor, type RouteDeps } from "./deps.js";

interface TemplateRow {
  id: string;
  name: string;
  introduction: string;
  cta: string;
  tone: string;
  max_length: number;
  created_by: string | null;
  updated_at: Date | string;
}

const TEMPLATE_SELECT = `
  select id, name, introduction, cta, tone, max_length, created_by, updated_at
    from templates`;

export function toTemplate(row: TemplateRow): Template {
  return parseDbContract(
    templateSchema,
    {
      id: row.id,
      name: row.name,
      introduction: row.introduction,
      cta: row.cta,
      tone: row.tone,
      maxLength: row.max_length,
      createdBy: row.created_by,
      updatedAt: toIso(row.updated_at),
    },
    "templates 行",
  );
}

export function registerTemplateRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "GET", "/templates", async (c) => {
    const auth = c.get("auth");
    const page = parseQuery(c, paginationQuerySchema);
    const result = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const total = await tx.query<{ n: string }>(`select count(*)::text as n from templates`);
      const rows = await tx.query<TemplateRow>(
        `${TEMPLATE_SELECT} order by updated_at desc, id limit $1 offset $2`,
        [page.limit, page.offset],
      );
      return {
        items: rows.rows.map(toTemplate),
        total: Number.parseInt(total.rows[0]?.n ?? "0", 10),
      };
    });
    return c.json(result);
  });

  registerRoute(v1, "GET", "/templates/:templateId", async (c) => {
    const auth = c.get("auth");
    const templateId = parseUuidParam(c, "templateId");
    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const result = await tx.query<TemplateRow>(`${TEMPLATE_SELECT} where id = $1`, [templateId]);
      return result.rows[0];
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "テンプレートが見つかりません");
    }
    return c.json(toTemplate(row));
  });

  registerRoute(v1, "POST", "/templates", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const body = await parseJsonBody(c, createTemplateRequestSchema);
    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const inserted = await tx.query<TemplateRow>(
        `insert into templates (tenant_id, name, introduction, cta, tone, max_length, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, name, introduction, cta, tone, max_length, created_by, updated_at`,
        [
          auth.tenantId,
          body.name,
          body.introduction,
          body.cta,
          body.tone,
          body.maxLength,
          actor.userId,
        ],
      );
      const template = inserted.rows[0];
      if (template === undefined) throw new Error("templates の INSERT が行を返しません");
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "template.created",
        resourceType: "Template",
        resourceId: template.id,
        metadata: { name: body.name },
        requestId,
      });
      return template;
    });
    return c.json(toTemplate(row), 201);
  });

  registerRoute(v1, "PATCH", "/templates/:templateId", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const templateId = parseUuidParam(c, "templateId");
    const body = await parseJsonBody(c, updateTemplateRequestSchema);
    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const updated = await tx.query<TemplateRow>(
        `update templates
            set name = coalesce($2, name),
                introduction = coalesce($3, introduction),
                cta = coalesce($4, cta),
                tone = coalesce($5, tone),
                max_length = coalesce($6, max_length),
                updated_at = now()
          where id = $1
          returning id, name, introduction, cta, tone, max_length, created_by, updated_at`,
        [
          templateId,
          body.name ?? null,
          body.introduction ?? null,
          body.cta ?? null,
          body.tone ?? null,
          body.maxLength ?? null,
        ],
      );
      const template = updated.rows[0];
      if (template === undefined) return undefined;
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "template.updated",
        resourceType: "Template",
        resourceId: templateId,
        metadata: { updatedFields: Object.keys(body) },
        requestId,
      });
      return template;
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "テンプレートが見つかりません");
    }
    return c.json(toTemplate(row));
  });

  registerRoute(v1, "DELETE", "/templates/:templateId", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const templateId = parseUuidParam(c, "templateId");
    const deleted = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const rows = await tx.query<{ id: string; name: string }>(
        `delete from templates where id = $1 returning id, name`,
        [templateId],
      );
      const row = rows.rows[0];
      if (row === undefined) return false;
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "template.deleted",
        resourceType: "Template",
        resourceId: templateId,
        metadata: { name: row.name },
        requestId,
      });
      return true;
    });
    if (!deleted) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "テンプレートが見つかりません");
    }
    return c.body(null, 204);
  });
}
