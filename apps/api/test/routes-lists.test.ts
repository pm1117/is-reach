// リストルート（F1 / F5）: CRUD・エントリ絞り込み・404 正規化・監査ログ。
import { apiErrorSchema } from "@is-reach/shared";
import { describe, expect, it } from "vitest";
import { bearer, buildTestApp, signTestJwt, tenantDbWithActor } from "./helpers.js";

const LIST_ID = "33333333-3333-4333-8333-333333333333";
const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const AT = "2026-07-14T00:00:00.000Z";

function listRow() {
  return {
    id: LIST_ID,
    name: "テストリスト",
    search_condition: { limit: 200 },
    created_by: null,
    created_at: AT,
  };
}

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    company_list_id: LIST_ID,
    status: "not_started",
    assignee_id: null,
    latest_deep_dive_job_id: null,
    match_evidence: [],
    created_at: AT,
    updated_at: AT,
    company_id: COMPANY_ID,
    company_name: "テスト株式会社",
    company_domain: "example.co.jp",
    company_industry: "software",
    company_employee_range: "51-100",
    company_region: "tokyo",
    ...overrides,
  };
}

describe("リスト CRUD", () => {
  it("GET /lists はページネーション付き一覧を返す", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/count\(\*\)::text as n from company_lists/, [{ n: "1" }]);
    tenantDb.respond(/from company_lists order by/, [listRow()]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/lists?limit=10", {
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe(LIST_ID);
  });

  it("POST /lists は根拠を再計算してエントリを作成し list.created を記録する", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/from companies where id = any/, [
      {
        id: COMPANY_ID,
        name: "テスト株式会社",
        domain: "example.co.jp",
        industry: "software",
        employee_range: "51-100",
        region: "tokyo",
      },
    ]);
    tenantDb.respond(/from signals where company_id = any/, []);
    tenantDb.respond(/insert into company_lists/, [listRow()]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/lists", {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({
        name: "テストリスト",
        searchCondition: {},
        companyIds: [COMPANY_ID],
      }),
    });
    expect(res.status).toBe(201);
    expect(tenantDb.findQueries(/insert into list_entries/)).toHaveLength(1);
    const audit = tenantDb.findQuery(/insert into audit_logs/);
    expect(audit?.values?.[2]).toBe("list.created");
  });

  it("POST /lists で存在しない企業 → 400 VALIDATION_FAILED", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/from companies where id = any/, []);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/lists", {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ name: "x", searchCondition: {}, companyIds: [COMPANY_ID] }),
    });
    expect(res.status).toBe(400);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("他テナント（RLS で 0 行）のリストは 404 に正規化される", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const res = await app.request(`/api/v1/lists/${LIST_ID}`, {
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("DELETE /lists/:id はメンバーでも可（2.2 決定）で list.deleted を記録する", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/delete from company_lists/, [{ id: LIST_ID, name: "テストリスト" }]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request(`/api/v1/lists/${LIST_ID}`, {
      method: "DELETE",
      headers: bearer(await signTestJwt({ role: "member" })),
    });
    expect(res.status).toBe(204);
    expect(tenantDb.findQuery(/insert into audit_logs/)?.values?.[2]).toBe("list.deleted");
  });

  it("不正な UUID のパスパラメータ → 400", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const res = await app.request("/api/v1/lists/not-a-uuid", {
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(400);
  });
});

describe("エントリ一覧・更新（F5）", () => {
  it("GET /lists/:id/entries は status / assigneeId で絞り込める", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from company_lists where id/, [{ id: LIST_ID }]);
    tenantDb.respond(/count\(\*\)::text as n from list_entries/, [{ n: "1" }]);
    tenantDb.respond(/from list_entries e/, [entryRow()]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request(`/api/v1/lists/${LIST_ID}/entries?status=not_started`, {
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(200);
    const filtered = tenantDb.findQuery(/count\(\*\)::text as n from list_entries/);
    expect(filtered?.values?.[1]).toBe("not_started");
  });

  it("enum 外の status フィルタ → 400", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const res = await app.request(`/api/v1/lists/${LIST_ID}/entries?status=archived`, {
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /entries/:id のステータス変更は entry.status_changed を before/after 付きで記録する", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/from list_entries e/, [entryRow()]);
    tenantDb.respond(/update list_entries/, [{ id: ENTRY_ID }]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request(`/api/v1/entries/${ENTRY_ID}`, {
      method: "PATCH",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ status: "sent" }),
    });
    expect(res.status).toBe(200);
    const audits = tenantDb.findQueries(/insert into audit_logs/);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.values?.[2]).toBe("entry.status_changed");
    expect(String(audits[0]?.values?.[5])).toContain("not_started");
    expect(String(audits[0]?.values?.[5])).toContain("sent");
  });

  it("PATCH /entries/:id で status も assigneeId もない → 400", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const res = await app.request(`/api/v1/entries/${ENTRY_ID}`, {
      method: "PATCH",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /entries/:id 対象なし → 404", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const res = await app.request(`/api/v1/entries/${ENTRY_ID}`, {
      method: "PATCH",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ status: "sent" }),
    });
    expect(res.status).toBe(404);
  });
});
