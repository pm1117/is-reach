// 深掘りジョブルート（F2 / E9）: 202・多重投入 409・failed → queued の retry 制約。
import { apiErrorSchema, createDeepDiveJobsResponseSchema } from "@is-reach/shared";
import { describe, expect, it } from "vitest";
import { JobNotEnqueuedError } from "../src/queue/pg-boss-queue.js";
import { TEST_TENANT_ID, bearer, buildTestApp, signTestJwt, tenantDbWithActor } from "./helpers.js";

const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const AT = "2026-07-14T00:00:00.000Z";

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    list_entry_id: ENTRY_ID,
    state: "queued",
    progress_fetched_pages: 0,
    progress_planned_pages: null,
    partial_failures: [],
    error: null,
    attempts: 0,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

describe("POST /api/v1/deep-dive-jobs", () => {
  it("202 でジョブを返し、singletonKey / groupKey 付きで投入する", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from list_entries where id = any/, [{ id: ENTRY_ID }]);
    tenantDb.respond(/select list_entry_id from deep_dive_jobs/, []);
    tenantDb.respond(/insert into deep_dive_jobs/, [jobRow()]);
    const { app, queue } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/deep-dive-jobs", {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ entryIds: [ENTRY_ID] }),
    });
    expect(res.status).toBe(202);
    const body = createDeepDiveJobsResponseSchema.parse(await res.json());
    expect(body.jobs[0]?.id).toBe(JOB_ID);
    expect(queue.enqueued).toEqual([
      {
        name: "deep_dive",
        payload: { deepDiveJobId: JOB_ID, tenantId: TEST_TENANT_ID },
        options: { singletonKey: `deep_dive:${ENTRY_ID}`, groupKey: TEST_TENANT_ID },
      },
    ]);
    // latest_deep_dive_job_id の更新と deep_dive.started 監査ログ
    expect(tenantDb.findQuery(/latest_deep_dive_job_id/)).toBeDefined();
    expect(tenantDb.findQuery(/insert into audit_logs/)?.values?.[2]).toBe("deep_dive.started");
  });

  it("実行中エントリへの再投入 → 409 JOB_ALREADY_RUNNING（E9）", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from list_entries where id = any/, [{ id: ENTRY_ID }]);
    tenantDb.respond(/select list_entry_id from deep_dive_jobs/, [{ list_entry_id: ENTRY_ID }]);
    const { app, queue } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/deep-dive-jobs", {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ entryIds: [ENTRY_ID] }),
    });
    expect(res.status).toBe(409);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("JOB_ALREADY_RUNNING");
    expect(body.error.details).toEqual({ entryIds: [ENTRY_ID] });
    expect(queue.enqueued).toHaveLength(0);
  });

  it("キュー側の singletonKey 重複（レース）も 409 に写像する", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from list_entries where id = any/, [{ id: ENTRY_ID }]);
    tenantDb.respond(/select list_entry_id from deep_dive_jobs/, []);
    tenantDb.respond(/insert into deep_dive_jobs/, [jobRow()]);
    const { app, queue } = buildTestApp({ tenantDb });
    queue.failNextEnqueueWith = new JobNotEnqueuedError("deep_dive");
    const res = await app.request("/api/v1/deep-dive-jobs", {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ entryIds: [ENTRY_ID] }),
    });
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("JOB_ALREADY_RUNNING");
  });

  it("存在しないエントリ → 404（他テナントも同じ見え方）", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from list_entries where id = any/, []);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/deep-dive-jobs", {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ entryIds: [ENTRY_ID] }),
    });
    expect(res.status).toBe(404);
  });

  it("entryIds 空配列 → 400", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const res = await app.request("/api/v1/deep-dive-jobs", {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ entryIds: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/deep-dive-jobs/:jobId", () => {
  it("ジョブ状態を契約どおり返す / 対象なしは 404", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/from deep_dive_jobs\s+where id/, [
      jobRow({ state: "failed", error: { code: "CRAWL_ALL_FAILED", message: "全滅" } }),
    ]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request(`/api/v1/deep-dive-jobs/${JOB_ID}`, {
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; error: { code: string } };
    expect(body.state).toBe("failed");
    expect(body.error.code).toBe("CRAWL_ALL_FAILED");

    const missing = buildTestApp({ tenantDb: tenantDbWithActor() });
    const notFound = await missing.app.request(`/api/v1/deep-dive-jobs/${JOB_ID}`, {
      headers: bearer(await signTestJwt()),
    });
    expect(notFound.status).toBe(404);
  });
});

describe("POST /api/v1/deep-dive-jobs/:jobId/retry", () => {
  it("failed → queued のみ許可し、deep_dive.retried を記録して再投入する", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/from deep_dive_jobs\s+where id/, [
      jobRow({ state: "failed", error: { code: "CRAWL_ALL_FAILED", message: "全滅" } }),
    ]);
    tenantDb.respond(/update deep_dive_jobs/, [jobRow({ state: "queued", attempts: 0 })]);
    const { app, queue } = buildTestApp({ tenantDb });
    const res = await app.request(`/api/v1/deep-dive-jobs/${JOB_ID}/retry`, {
      method: "POST",
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(202);
    expect(tenantDb.findQuery(/insert into audit_logs/)?.values?.[2]).toBe("deep_dive.retried");
    expect(queue.enqueued[0]?.options?.singletonKey).toBe(`deep_dive:${ENTRY_ID}`);
  });

  it("failed 以外の state → 409 RESOURCE_CONFLICT", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/from deep_dive_jobs\s+where id/, [jobRow({ state: "collecting" })]);
    const { app, queue } = buildTestApp({ tenantDb });
    const res = await app.request(`/api/v1/deep-dive-jobs/${JOB_ID}/retry`, {
      method: "POST",
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("RESOURCE_CONFLICT");
    expect(queue.enqueued).toHaveLength(0);
  });
});
