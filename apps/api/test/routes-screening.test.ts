// スクリーニングルート（F1）: 共有プール → analysis 結線・監査ログ・検証エラー。
import { apiErrorSchema, screeningSearchResponseSchema } from "@is-reach/shared";
import { describe, expect, it } from "vitest";
import { TEST_TENANT_ID, bearer, buildTestApp, signTestJwt, tenantDbWithActor } from "./helpers.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const SIGNAL_ID = "22222222-2222-4222-8222-222222222222";

function screeningDb() {
  const db = tenantDbWithActor();
  db.respond(/from companies/, [
    {
      id: COMPANY_ID,
      name: "テスト株式会社",
      domain: "example.co.jp",
      industry: "software",
      employee_range: "51-100",
      region: "tokyo",
    },
  ]);
  db.respond(/from signals/, [
    {
      id: SIGNAL_ID,
      company_id: COMPANY_ID,
      kind: "job_posting",
      summary: "React エンジニア募集",
      attributes: { keywords: ["React"] },
      source_url: "https://example.co.jp/careers/1",
      collected_at: "2026-07-13T00:00:00.000Z",
    },
  ]);
  return db;
}

describe("POST /api/v1/screening/searches", () => {
  it("共有プールから取得し analysis のスコア・根拠付きで返す（同期・即時応答）", async () => {
    const tenantDb = screeningDb();
    const { app } = buildTestApp({
      tenantDb,
      now: () => new Date("2026-07-14T00:00:00.000Z"),
    });
    const token = await signTestJwt();
    const res = await app.request("/api/v1/screening/searches", {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ signals: { kinds: ["job_posting"], keywords: ["react"] } }),
    });
    expect(res.status).toBe(200);
    const body = screeningSearchResponseSchema.parse(await res.json());
    expect(body.total).toBe(1);
    expect(body.results[0]?.company.id).toBe(COMPANY_ID);
    expect(body.results[0]?.score).toBeGreaterThan(0);
    expect(body.results[0]?.matchedSignals[0]?.signalId).toBe(SIGNAL_ID);
  });

  it("screening.searched 監査ログに検索条件を記録する（7.1）", async () => {
    const tenantDb = screeningDb();
    const { app } = buildTestApp({ tenantDb });
    const token = await signTestJwt();
    await app.request("/api/v1/screening/searches", {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ signals: { kinds: ["job_posting"] } }),
    });
    const audit = tenantDb.findQuery(/insert into audit_logs/);
    expect(audit).toBeDefined();
    expect(audit?.values?.[2]).toBe("screening.searched");
    expect(String(audit?.values?.[5])).toContain("job_posting"); // metadata.condition
    expect(tenantDb.contexts[0]).toBe(TEST_TENANT_ID);
  });

  it("limit 上限（500）超過・enum 外 kind は 400 VALIDATION_FAILED", async () => {
    const { app } = buildTestApp({ tenantDb: screeningDb() });
    const token = await signTestJwt();
    for (const body of [{ limit: 1000 }, { signals: { kinds: ["sns"] } }]) {
      const res = await app.request("/api/v1/screening/searches", {
        method: "POST",
        headers: { ...bearer(token), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(apiErrorSchema.parse(await res.json()).error.code).toBe("VALIDATION_FAILED");
    }
  });
});

describe("GET /api/v1/screening/facets", () => {
  it("実在値の distinct + シグナル種別 enum を返す", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/distinct industry/, [{ v: "software" }]);
    tenantDb.respond(/distinct employee_range/, [{ v: "51-100" }]);
    tenantDb.respond(/distinct region/, [{ v: "tokyo" }]);
    const { app } = buildTestApp({ tenantDb });
    const token = await signTestJwt();
    const res = await app.request("/api/v1/screening/facets", { headers: bearer(token) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      industries: ["software"],
      employeeRanges: ["51-100"],
      regions: ["tokyo"],
      signalKinds: ["job_posting", "tech_blog", "press_release"],
    });
  });
});
