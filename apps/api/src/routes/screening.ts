// スクリーニング（design-detail 2.2 — 要件 F1）。
// POST /screening/searches: 共有プール（companies / signals — app_user は SELECT のみ）を
// SQL で粗く絞り、analysis の runScreeningSearch（LLM 不使用・決定的）に渡す。同期・即時応答。
// GET /screening/facets: 検索条件の選択肢メタ。
import {
  screeningFacetsResponseSchema,
  screeningSearchRequestSchema,
  signalKindSchema,
  type ScreeningSearchRequest,
} from "@is-reach/shared";
import { runScreeningSearch, type CompanyRecord, type SignalRecord } from "@is-reach/analysis";
import type { Hono } from "hono";
import { ZodError } from "zod";
import { recordAuditEvent } from "../audit/audit-log.js";
import { registerRoute } from "../middleware/authorize.js";
import type { AppEnv } from "../types.js";
import { parseDbContract, parseJsonBody, toIso } from "../validation.js";
import { nowIso, resolveActor, type RouteDeps } from "./deps.js";

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employee_range: string | null;
  region: string | null;
}

interface SignalRow {
  id: string;
  company_id: string;
  kind: string;
  summary: string;
  attributes: unknown;
  source_url: string;
  collected_at: Date | string;
}

/** attributes JSONB から抽出キーワード配列を取り出す（形は保証されないため防御的に） */
function keywordsOf(attributes: unknown): string[] {
  if (attributes === null || typeof attributes !== "object") return [];
  const keywords = (attributes as Record<string, unknown>).keywords;
  if (!Array.isArray(keywords)) return [];
  return keywords.filter((value): value is string => typeof value === "string");
}

function toNullableArray(values: readonly string[] | undefined): string[] | null {
  return values !== undefined && values.length > 0 ? [...values] : null;
}

export function registerScreeningRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "POST", "/screening/searches", async (c) => {
    const request: ScreeningSearchRequest = await parseJsonBody(c, screeningSearchRequestSchema);
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const evaluatedAt = nowIso(deps);

    const response = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);

      // 属性の粗絞り（インデックス活用 — E15）。詳細な判定・スコアは analysis が行う
      const companiesResult = await tx.query<CompanyRow>(
        `select id, name, domain, industry, employee_range, region
           from companies
          where ($1::text[] is null or industry = any($1))
            and ($2::text[] is null or employee_range = any($2))
            and ($3::text[] is null or region = any($3))`,
        [
          toNullableArray(request.attributes?.industries),
          toNullableArray(request.attributes?.employeeRanges),
          toNullableArray(request.attributes?.regions),
        ],
      );
      const companies: CompanyRecord[] = companiesResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        domain: row.domain,
        industry: row.industry,
        employeeRange: row.employee_range,
        region: row.region,
      }));

      let signals: SignalRecord[] = [];
      if (companies.length > 0) {
        const freshWithinDays = request.signals?.freshWithinDays;
        const freshSince =
          freshWithinDays === undefined
            ? null
            : new Date(Date.parse(evaluatedAt) - freshWithinDays * 86_400_000).toISOString();
        const signalsResult = await tx.query<SignalRow>(
          `select id, company_id, kind, summary, attributes, source_url, collected_at
             from signals
            where company_id = any($1::uuid[])
              and ($2::timestamptz is null or collected_at >= $2)`,
          [companies.map((company) => company.id), freshSince],
        );
        signals = signalsResult.rows.map((row) => ({
          id: row.id,
          companyId: row.company_id,
          kind: row.kind as SignalRecord["kind"], // runScreeningSearch が enum 検証する
          summary: row.summary,
          keywords: keywordsOf(row.attributes),
          sourceUrl: row.source_url,
          collectedAt: toIso(row.collected_at),
        }));
      }

      let searchResponse;
      try {
        searchResponse = runScreeningSearch({ companies, signals, request, evaluatedAt });
      } catch (error) {
        if (error instanceof ZodError) {
          // リクエストは検証済みのため、ここでの ZodError は共有プールのデータ不整合
          throw new Error(`共有プールのデータが契約に適合しません: ${error.message}`);
        }
        throw error;
      }

      // screening.searched: 検索条件を metadata に記録（design-detail 7.1）
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "screening.searched",
        metadata: { condition: request, total: searchResponse.total },
        requestId,
      });
      return searchResponse;
    });

    return c.json(response);
  });

  registerRoute(v1, "GET", "/screening/facets", async (c) => {
    const auth = c.get("auth");
    const facets = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const [industries, employeeRanges, regions] = await Promise.all([
        tx.query<{ v: string }>(
          `select distinct industry as v from companies where industry is not null order by 1`,
        ),
        tx.query<{ v: string }>(
          `select distinct employee_range as v from companies where employee_range is not null order by 1`,
        ),
        tx.query<{ v: string }>(
          `select distinct region as v from companies where region is not null order by 1`,
        ),
      ]);
      return {
        industries: industries.rows.map((row) => row.v),
        employeeRanges: employeeRanges.rows.map((row) => row.v),
        regions: regions.rows.map((row) => row.v),
        signalKinds: [...signalKindSchema.options],
      };
    });
    return c.json(parseDbContract(screeningFacetsResponseSchema, facets, "facets"));
  });
}
