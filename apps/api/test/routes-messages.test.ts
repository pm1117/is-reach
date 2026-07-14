// メッセージルート（F4 / F5 / E13）: 202 投入・前提条件・編集・コピー記録。
import { apiErrorSchema } from "@is-reach/shared";
import { describe, expect, it } from "vitest";
import { JobNotEnqueuedError } from "../src/queue/pg-boss-queue.js";
import { TEST_TENANT_ID, bearer, buildTestApp, signTestJwt, tenantDbWithActor } from "./helpers.js";

const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "66666666-6666-4666-8666-666666666666";
const DOSSIER_ID = "77777777-7777-4777-8777-777777777777";
const MESSAGE_ID = "88888888-8888-4888-8888-888888888888";
const MESSAGE_JOB_ID = "99999999-9999-4999-8999-999999999999";
const AT = "2026-07-14T00:00:00.000Z";

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    list_entry_id: ENTRY_ID,
    template_id: TEMPLATE_ID,
    dossier_id: DOSSIER_ID,
    parts: { hook: "h", issueMention: "i", introduction: "自社紹介", cta: "CTA" },
    assembled_body: "本文全体",
    edited_body: null,
    validation: { ok: false, warnings: [{ code: "URL_IN_OUTPUT", detail: "URL 混入" }] },
    model_id: "claude-haiku-test",
    generated_at: AT,
    edited_at: null,
    ...overrides,
  };
}

function generationReadyDb() {
  const db = tenantDbWithActor();
  db.respond(/select id from list_entries where id/, [{ id: ENTRY_ID }]);
  db.respond(/select id from templates where id/, [{ id: TEMPLATE_ID }]);
  db.respond(/select id from dossiers where list_entry_id/, [{ id: DOSSIER_ID }]);
  db.respond(/select id from message_jobs/, []);
  db.respond(/insert into message_jobs/, [{ id: MESSAGE_JOB_ID }]);
  return db;
}

describe("POST /api/v1/entries/:entryId/messages", () => {
  it("202 で jobId を返し singletonKey / groupKey 付きで投入する", async () => {
    const tenantDb = generationReadyDb();
    const { app, queue } = buildTestApp({ tenantDb });
    const res = await app.request(`/api/v1/entries/${ENTRY_ID}/messages`, {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ templateId: TEMPLATE_ID }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: MESSAGE_JOB_ID });
    expect(queue.enqueued).toEqual([
      {
        name: "generate_message",
        payload: { messageJobId: MESSAGE_JOB_ID, tenantId: TEST_TENANT_ID },
        options: {
          singletonKey: `generate_message:${ENTRY_ID}`,
          groupKey: TEST_TENANT_ID,
        },
      },
    ]);
  });

  it("ドシエ未生成 → 409 RESOURCE_CONFLICT（先に深掘りが必要）", async () => {
    const db = tenantDbWithActor();
    db.respond(/select id from list_entries where id/, [{ id: ENTRY_ID }]);
    db.respond(/select id from templates where id/, [{ id: TEMPLATE_ID }]);
    db.respond(/select id from dossiers where list_entry_id/, []);
    const { app } = buildTestApp({ tenantDb: db });
    const res = await app.request(`/api/v1/entries/${ENTRY_ID}/messages`, {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ templateId: TEMPLATE_ID }),
    });
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("RESOURCE_CONFLICT");
  });

  it("実行中ジョブあり → 409 JOB_ALREADY_RUNNING", async () => {
    const db = tenantDbWithActor();
    db.respond(/select id from list_entries where id/, [{ id: ENTRY_ID }]);
    db.respond(/select id from templates where id/, [{ id: TEMPLATE_ID }]);
    db.respond(/select id from dossiers where list_entry_id/, [{ id: DOSSIER_ID }]);
    db.respond(/select id from message_jobs/, [{ id: MESSAGE_JOB_ID }]);
    const { app } = buildTestApp({ tenantDb: db });
    const res = await app.request(`/api/v1/entries/${ENTRY_ID}/messages`, {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ templateId: TEMPLATE_ID }),
    });
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("JOB_ALREADY_RUNNING");
  });

  it("キュー側レースの JobNotEnqueuedError → 409", async () => {
    const tenantDb = generationReadyDb();
    const { app, queue } = buildTestApp({ tenantDb });
    queue.failNextEnqueueWith = new JobNotEnqueuedError("generate_message");
    const res = await app.request(`/api/v1/entries/${ENTRY_ID}/messages`, {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ templateId: TEMPLATE_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("テンプレートなし → 404", async () => {
    const db = tenantDbWithActor();
    db.respond(/select id from list_entries where id/, [{ id: ENTRY_ID }]);
    db.respond(/select id from templates where id/, []);
    const { app } = buildTestApp({ tenantDb: db });
    const res = await app.request(`/api/v1/entries/${ENTRY_ID}/messages`, {
      method: "POST",
      headers: { ...bearer(await signTestJwt()), "content-type": "application/json" },
      body: JSON.stringify({ templateId: TEMPLATE_ID }),
    });
    expect(res.status).toBe(404);
  });
});

describe("メッセージ閲覧・編集・コピー記録", () => {
  it("GET /message-jobs/:jobId → 契約どおり / 404", async () => {
    const db = tenantDbWithActor();
    db.respond(/from message_jobs\s+where id/, [
      {
        id: MESSAGE_JOB_ID,
        list_entry_id: ENTRY_ID,
        state: "done",
        message_id: MESSAGE_ID,
        error: null,
        created_at: AT,
        updated_at: AT,
      },
    ]);
    const { app } = buildTestApp({ tenantDb: db });
    const res = await app.request(`/api/v1/message-jobs/${MESSAGE_JOB_ID}`, {
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { messageId: string }).messageId).toBe(MESSAGE_ID);

    const empty = buildTestApp({ tenantDb: tenantDbWithActor() });
    const notFound = await empty.app.request(`/api/v1/message-jobs/${MESSAGE_JOB_ID}`, {
      headers: bearer(await signTestJwt()),
    });
    expect(notFound.status).toBe(404);
  });

  it("PATCH /messages/:id は編集本文を保存し message.edited を記録する（メンバー可 — E3）", async () => {
    const db = tenantDbWithActor();
    db.respond(/update messages set edited_body/, [
      messageRow({ edited_body: "編集後", edited_at: AT }),
    ]);
    const { app } = buildTestApp({ tenantDb: db });
    const res = await app.request(`/api/v1/messages/${MESSAGE_ID}`, {
      method: "PATCH",
      headers: {
        ...bearer(await signTestJwt({ role: "member" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({ editedBody: "編集後" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { editedBody: string }).editedBody).toBe("編集後");
    expect(db.findQuery(/insert into audit_logs/)?.values?.[2]).toBe("message.edited");
  });

  it("POST /messages/:id/copy-events は 204 を返し警告有無を metadata に記録する", async () => {
    const db = tenantDbWithActor();
    db.respond(/from messages\s+where id/, [messageRow()]);
    const { app } = buildTestApp({ tenantDb: db });
    const res = await app.request(`/api/v1/messages/${MESSAGE_ID}/copy-events`, {
      method: "POST",
      headers: bearer(await signTestJwt()),
    });
    expect(res.status).toBe(204);
    const audit = db.findQuery(/insert into audit_logs/);
    expect(audit?.values?.[2]).toBe("message.copied");
    const metadata = String(audit?.values?.[5]);
    expect(metadata).toContain('"warned":true');
    expect(metadata).toContain("URL_IN_OUTPUT");
  });

  it("メッセージなしの copy-events / PATCH → 404", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const token = await signTestJwt();
    const copy = await app.request(`/api/v1/messages/${MESSAGE_ID}/copy-events`, {
      method: "POST",
      headers: bearer(token),
    });
    expect(copy.status).toBe(404);
    const patch = await app.request(`/api/v1/messages/${MESSAGE_ID}`, {
      method: "PATCH",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ editedBody: "x" }),
    });
    expect(patch.status).toBe(404);
  });
});
