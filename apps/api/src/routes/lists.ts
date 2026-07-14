// 企業リスト（design-detail 2.2 — 要件 F1 / F5）。
// リスト CRUD・エントリ一覧・エントリ更新。他テナントのリソースは RLS で 0 行になるため
// 404 に正規化される（2.5）。
import {
  companyListSchema,
  createListRequestSchema,
  listEntriesQuerySchema,
  listEntrySchema,
  paginationQuerySchema,
  updateListEntryRequestSchema,
  updateListRequestSchema,
  type CompanyList,
  type ListEntry,
  type MatchedSignal,
  type ScreeningSearchRequest,
} from "@is-reach/shared";
import { runScreeningSearch, type CompanyRecord, type SignalRecord } from "@is-reach/analysis";
import type { Hono } from "hono";
import { recordAuditEvent } from "../audit/audit-log.js";
import { ApiHttpError } from "../errors.js";
import { registerRoute } from "../middleware/authorize.js";
import type { AppEnv } from "../types.js";
import type { TenantQuerier } from "../db/tenant-db.js";
import {
  parseDbContract,
  parseJsonBody,
  parseQuery,
  parseUuidParam,
  toIso,
} from "../validation.js";
import { nowIso, resolveActor, type RouteDeps } from "./deps.js";

interface ListRow {
  id: string;
  name: string;
  search_condition: unknown;
  created_by: string | null;
  created_at: Date | string;
}

function toCompanyList(row: ListRow): CompanyList {
  return parseDbContract(
    companyListSchema,
    {
      id: row.id,
      name: row.name,
      searchCondition: row.search_condition,
      createdBy: row.created_by,
      createdAt: toIso(row.created_at),
    },
    "company_lists 行",
  );
}

interface EntryRow {
  id: string;
  company_list_id: string;
  status: string;
  assignee_id: string | null;
  latest_deep_dive_job_id: string | null;
  match_evidence: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  company_id: string;
  company_name: string;
  company_domain: string | null;
  company_industry: string | null;
  company_employee_range: string | null;
  company_region: string | null;
}

function toListEntry(row: EntryRow): ListEntry {
  return parseDbContract(
    listEntrySchema,
    {
      id: row.id,
      companyListId: row.company_list_id,
      company: {
        id: row.company_id,
        name: row.company_name,
        domain: row.company_domain,
        industry: row.company_industry,
        employeeRange: row.company_employee_range,
        region: row.company_region,
      },
      matchEvidence: row.match_evidence,
      status: row.status,
      assigneeId: row.assignee_id,
      latestDeepDiveJobId: row.latest_deep_dive_job_id,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    },
    "list_entries 行",
  );
}

const ENTRY_SELECT = `
  select e.id, e.company_list_id, e.status, e.assignee_id, e.latest_deep_dive_job_id,
         e.match_evidence, e.created_at, e.updated_at,
         c.id as company_id, c.name as company_name, c.domain as company_domain,
         c.industry as company_industry, c.employee_range as company_employee_range,
         c.region as company_region
    from list_entries e
    join companies c on c.id = e.company_id`;

/** リスト作成時のマッチ根拠を再計算する（要件 F1 受け入れ条件 2 — analysis を再利用） */
async function computeEvidence(
  tx: TenantQuerier,
  request: ScreeningSearchRequest,
  companyIds: readonly string[],
  evaluatedAt: string,
): Promise<Map<string, MatchedSignal[]>> {
  const companiesResult = await tx.query<{
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    employee_range: string | null;
    region: string | null;
  }>(
    `select id, name, domain, industry, employee_range, region
       from companies where id = any($1::uuid[])`,
    [companyIds],
  );
  const companies: CompanyRecord[] = companiesResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    employeeRange: row.employee_range,
    region: row.region,
  }));
  if (companies.length !== companyIds.length) {
    const found = new Set(companies.map((company) => company.id));
    const missing = companyIds.filter((id) => !found.has(id));
    throw new ApiHttpError("VALIDATION_FAILED", "存在しない企業が含まれています", {
      companyIds: missing,
    });
  }

  const signalsResult = await tx.query<{
    id: string;
    company_id: string;
    kind: string;
    summary: string;
    attributes: unknown;
    source_url: string;
    collected_at: Date | string;
  }>(
    `select id, company_id, kind, summary, attributes, source_url, collected_at
       from signals where company_id = any($1::uuid[])`,
    [companyIds],
  );
  const signals: SignalRecord[] = signalsResult.rows.map((row) => {
    const attributes = row.attributes;
    const rawKeywords =
      attributes !== null && typeof attributes === "object"
        ? (attributes as Record<string, unknown>).keywords
        : undefined;
    return {
      id: row.id,
      companyId: row.company_id,
      kind: row.kind as SignalRecord["kind"],
      summary: row.summary,
      keywords: Array.isArray(rawKeywords)
        ? rawKeywords.filter((v): v is string => typeof v === "string")
        : [],
      sourceUrl: row.source_url,
      collectedAt: toIso(row.collected_at),
    };
  });

  // 採用企業だけを対象に検索条件を再適用し、根拠（matchedSignals）を得る。
  // limit は全採用企業が返るよう上限値にする
  const response = runScreeningSearch({
    companies,
    signals,
    request: { ...request, limit: 500 },
    evaluatedAt,
  });
  return new Map(response.results.map((result) => [result.company.id, result.matchedSignals]));
}

export function registerListRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "GET", "/lists", async (c) => {
    const auth = c.get("auth");
    const page = parseQuery(c, paginationQuerySchema);
    const result = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const total = await tx.query<{ n: string }>(`select count(*)::text as n from company_lists`);
      const rows = await tx.query<ListRow>(
        `select id, name, search_condition, created_by, created_at
           from company_lists order by created_at desc, id limit $1 offset $2`,
        [page.limit, page.offset],
      );
      return {
        items: rows.rows.map(toCompanyList),
        total: Number.parseInt(total.rows[0]?.n ?? "0", 10),
      };
    });
    return c.json(result);
  });

  registerRoute(v1, "POST", "/lists", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const body = await parseJsonBody(c, createListRequestSchema);
    const evaluatedAt = nowIso(deps);
    const uniqueCompanyIds = [...new Set(body.companyIds)];

    const list = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const evidence = await computeEvidence(
        tx,
        body.searchCondition,
        uniqueCompanyIds,
        evaluatedAt,
      );

      const inserted = await tx.query<ListRow>(
        `insert into company_lists (tenant_id, name, search_condition, created_by)
         values ($1, $2, $3, $4)
         returning id, name, search_condition, created_by, created_at`,
        [auth.tenantId, body.name, JSON.stringify(body.searchCondition), actor.userId],
      );
      const listRow = inserted.rows[0];
      if (listRow === undefined) throw new Error("company_lists の INSERT が行を返しません");

      for (const companyId of uniqueCompanyIds) {
        await tx.query(
          `insert into list_entries (tenant_id, company_list_id, company_id, match_evidence)
           values ($1, $2, $3, $4)`,
          [auth.tenantId, listRow.id, companyId, JSON.stringify(evidence.get(companyId) ?? [])],
        );
      }

      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "list.created",
        resourceType: "CompanyList",
        resourceId: listRow.id,
        metadata: { name: body.name, entryCount: uniqueCompanyIds.length },
        requestId,
      });
      return toCompanyList(listRow);
    });
    return c.json(list, 201);
  });

  registerRoute(v1, "GET", "/lists/:listId", async (c) => {
    const auth = c.get("auth");
    const listId = parseUuidParam(c, "listId");
    const list = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const rows = await tx.query<ListRow>(
        `select id, name, search_condition, created_by, created_at
           from company_lists where id = $1`,
        [listId],
      );
      return rows.rows[0];
    });
    if (list === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "リストが見つかりません");
    }
    return c.json(toCompanyList(list));
  });

  registerRoute(v1, "PATCH", "/lists/:listId", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const listId = parseUuidParam(c, "listId");
    const body = await parseJsonBody(c, updateListRequestSchema);
    const list = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const rows = await tx.query<ListRow>(
        `update company_lists set name = $2 where id = $1
         returning id, name, search_condition, created_by, created_at`,
        [listId, body.name],
      );
      const row = rows.rows[0];
      if (row === undefined) return undefined;
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "list.updated",
        resourceType: "CompanyList",
        resourceId: listId,
        metadata: { name: body.name },
        requestId,
      });
      return row;
    });
    if (list === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "リストが見つかりません");
    }
    return c.json(toCompanyList(list));
  });

  registerRoute(v1, "DELETE", "/lists/:listId", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const listId = parseUuidParam(c, "listId");
    const deleted = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const rows = await tx.query<{ id: string; name: string }>(
        `delete from company_lists where id = $1 returning id, name`,
        [listId],
      );
      const row = rows.rows[0];
      if (row === undefined) return false;
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "list.deleted",
        resourceType: "CompanyList",
        resourceId: listId,
        metadata: { name: row.name },
        requestId,
      });
      return true;
    });
    if (!deleted) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "リストが見つかりません");
    }
    return c.body(null, 204);
  });

  registerRoute(v1, "GET", "/lists/:listId/entries", async (c) => {
    const auth = c.get("auth");
    const listId = parseUuidParam(c, "listId");
    const filter = parseQuery(c, listEntriesQuerySchema);
    const page = parseQuery(c, paginationQuerySchema);
    const result = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const list = await tx.query(`select id from company_lists where id = $1`, [listId]);
      if (list.rows.length === 0) return undefined;
      const where = `where e.company_list_id = $1
            and ($2::text is null or e.status = $2)
            and ($3::uuid is null or e.assignee_id = $3)`;
      const total = await tx.query<{ n: string }>(
        `select count(*)::text as n from list_entries e ${where}`,
        [listId, filter.status ?? null, filter.assigneeId ?? null],
      );
      const rows = await tx.query<EntryRow>(
        `${ENTRY_SELECT} ${where} order by e.created_at desc, e.id limit $4 offset $5`,
        [listId, filter.status ?? null, filter.assigneeId ?? null, page.limit, page.offset],
      );
      return {
        items: rows.rows.map(toListEntry),
        total: Number.parseInt(total.rows[0]?.n ?? "0", 10),
      };
    });
    if (result === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "リストが見つかりません");
    }
    return c.json(result);
  });

  registerRoute(v1, "PATCH", "/entries/:entryId", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const entryId = parseUuidParam(c, "entryId");
    const body = await parseJsonBody(c, updateListEntryRequestSchema);

    const entry = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const current = await tx.query<EntryRow>(`${ENTRY_SELECT} where e.id = $1`, [entryId]);
      const before = current.rows[0];
      if (before === undefined) return undefined;

      if (body.assigneeId !== undefined && body.assigneeId !== null) {
        const assignee = await tx.query(`select id from users where id = $1`, [body.assigneeId]);
        if (assignee.rows.length === 0) {
          throw new ApiHttpError("VALIDATION_FAILED", "担当者に指定したユーザーが存在しません", {
            assigneeId: body.assigneeId,
          });
        }
      }

      const updated = await tx.query<{ id: string }>(
        `update list_entries
            set status = coalesce($2, status),
                assignee_id = case when $3::boolean then $4::uuid else assignee_id end,
                updated_at = now()
          where id = $1 returning id`,
        [entryId, body.status ?? null, body.assigneeId !== undefined, body.assigneeId ?? null],
      );
      if (updated.rows.length === 0) return undefined;

      if (body.status !== undefined && body.status !== before.status) {
        await recordAuditEvent(tx, {
          tenantId: auth.tenantId,
          actorUserId: actor.userId,
          eventType: "entry.status_changed",
          resourceType: "ListEntry",
          resourceId: entryId,
          metadata: { before: before.status, after: body.status },
          requestId,
        });
      }
      if (body.assigneeId !== undefined && body.assigneeId !== before.assignee_id) {
        await recordAuditEvent(tx, {
          tenantId: auth.tenantId,
          actorUserId: actor.userId,
          eventType: "entry.assignee_changed",
          resourceType: "ListEntry",
          resourceId: entryId,
          metadata: { before: before.assignee_id, after: body.assigneeId },
          requestId,
        });
      }

      const after = await tx.query<EntryRow>(`${ENTRY_SELECT} where e.id = $1`, [entryId]);
      return after.rows[0];
    });
    if (entry === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "エントリが見つかりません");
    }
    return c.json(toListEntry(entry));
  });
}
