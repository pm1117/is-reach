// 管理系ルート: テンプレート変更（E3）・ユーザー管理・テナント設定・監査ログ・PII 削除。
// 認可マトリクスの実効（メンバー 403）と監査ログ記録を実アプリ構成で検証する。
import { apiErrorSchema } from "@is-reach/shared";
import { describe, expect, it } from "vitest";
import {
  TEST_AUTH_USER_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  bearer,
  buildTestApp,
  signTestJwt,
  tenantDbWithActor,
} from "./helpers.js";

const TEMPLATE_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const AT = "2026-07-14T00:00:00.000Z";

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    name: "標準テンプレート",
    introduction: "自社紹介",
    cta: "CTA",
    tone: "polite",
    max_length: 600,
    created_by: TEST_USER_ID,
    updated_at: AT,
    ...overrides,
  };
}

describe("テンプレート変更系（E3: 管理者のみ）", () => {
  it("メンバーの POST /templates → 403（DB へ到達しない）", async () => {
    const tenantDb = tenantDbWithActor();
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/templates", {
      method: "POST",
      headers: {
        ...bearer(await signTestJwt({ role: "member" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "x", introduction: "i", cta: "c", tone: "", maxLength: 500 }),
    });
    expect(res.status).toBe(403);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("AUTH_FORBIDDEN");
    expect(tenantDb.contexts).toHaveLength(0);
  });

  it("管理者の POST /templates → 201 + template.created", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/insert into templates/, [templateRow()]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/templates", {
      method: "POST",
      headers: {
        ...bearer(await signTestJwt({ role: "admin" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "標準テンプレート",
        introduction: "自社紹介",
        cta: "CTA",
        tone: "polite",
        maxLength: 600,
      }),
    });
    expect(res.status).toBe(201);
    expect(tenantDb.findQuery(/insert into audit_logs/)?.values?.[2]).toBe("template.created");
  });

  it("テンプレート閲覧はメンバー可（E3: 閲覧・利用のみ）", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/count\(\*\)::text as n from templates/, [{ n: "1" }]);
    tenantDb.respond(/from templates order by/, [templateRow()]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/templates", {
      headers: bearer(await signTestJwt({ role: "member" })),
    });
    expect(res.status).toBe(200);
  });

  it("管理者の DELETE /templates/:id → 204 + template.deleted / 対象なし 404", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/delete from templates/, [{ id: TEMPLATE_ID, name: "標準テンプレート" }]);
    const { app } = buildTestApp({ tenantDb });
    const token = await signTestJwt({ role: "admin" });
    const res = await app.request(`/api/v1/templates/${TEMPLATE_ID}`, {
      method: "DELETE",
      headers: bearer(token),
    });
    expect(res.status).toBe(204);
    expect(tenantDb.findQuery(/insert into audit_logs/)?.values?.[2]).toBe("template.deleted");

    const empty = buildTestApp({ tenantDb: tenantDbWithActor() });
    const notFound = await empty.app.request(`/api/v1/templates/${TEMPLATE_ID}`, {
      method: "DELETE",
      headers: bearer(token),
    });
    expect(notFound.status).toBe(404);
  });
});

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OTHER_USER_ID,
    auth_user_id: TEST_AUTH_USER_ID,
    email: "member@example.com",
    display_name: "メンバー",
    role: "member",
    invitation_status: "active",
    created_at: AT,
    ...overrides,
  };
}

describe("ユーザー管理（F6）", () => {
  it("GET /users はメンバーも可（担当者アサイン用 — 2.2）", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/count\(\*\)::text as n from users/, [{ n: "1" }]);
    tenantDb.respond(/from users order by/, [userRow()]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/users", {
      headers: bearer(await signTestJwt({ role: "member" })),
    });
    expect(res.status).toBe(200);
  });

  it("メンバーの招待・ロール変更・無効化 → 403", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const token = await signTestJwt({ role: "member" });
    const invite = await app.request("/api/v1/users/invitations", {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", role: "member" }),
    });
    expect(invite.status).toBe(403);
    const patch = await app.request(`/api/v1/users/${OTHER_USER_ID}`, {
      method: "PATCH",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(patch.status).toBe(403);
    const remove = await app.request(`/api/v1/users/${OTHER_USER_ID}`, {
      method: "DELETE",
      headers: bearer(token),
    });
    expect(remove.status).toBe(403);
  });

  it("招待: AuthAdmin 経由で app_metadata（tenant_id / role）を渡し user.invited を記録する", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from users where email/, []);
    tenantDb.respond(/insert into users/, [
      userRow({ email: "new@example.com", invitation_status: "invited" }),
    ]);
    const { app, authAdmin } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/users/invitations", {
      method: "POST",
      headers: {
        ...bearer(await signTestJwt({ role: "admin" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "new@example.com", role: "member" }),
    });
    expect(res.status).toBe(201);
    expect(authAdmin.invites).toEqual([
      {
        email: "new@example.com",
        appMetadata: { tenant_id: TEST_TENANT_ID, role: "member" },
      },
    ]);
    expect(tenantDb.findQuery(/insert into audit_logs/)?.values?.[2]).toBe("user.invited");
  });

  it("招待: 重複メール → 409（AuthAdmin は呼ばれない）", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from users where email/, [{ id: OTHER_USER_ID }]);
    const { app, authAdmin } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/users/invitations", {
      method: "POST",
      headers: {
        ...bearer(await signTestJwt({ role: "admin" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "dup@example.com", role: "member" }),
    });
    expect(res.status).toBe(409);
    expect(authAdmin.invites).toHaveLength(0);
  });

  it("ロール変更: users 更新 + JWT 側 app_metadata 同期 + user.role_changed（before/after）", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/from users\s+where id = \$1/, [userRow()]);
    tenantDb.respond(/update users set role/, [userRow({ role: "admin" })]);
    const { app, authAdmin } = buildTestApp({ tenantDb });
    const res = await app.request(`/api/v1/users/${OTHER_USER_ID}`, {
      method: "PATCH",
      headers: {
        ...bearer(await signTestJwt({ role: "admin" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(200);
    expect(authAdmin.metadataUpdates).toEqual([
      {
        authUserId: TEST_AUTH_USER_ID,
        appMetadata: { tenant_id: TEST_TENANT_ID, role: "admin" },
      },
    ]);
    const audit = tenantDb.findQuery(/insert into audit_logs/);
    expect(audit?.values?.[2]).toBe("user.role_changed");
    expect(String(audit?.values?.[5])).toContain("member");
    expect(String(audit?.values?.[5])).toContain("admin");
  });

  it("無効化: invitation_status = disabled + Auth 無効化 + user.removed。自分自身は 409", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/update users set invitation_status = 'disabled'/, [
      userRow({ invitation_status: "disabled" }),
    ]);
    const { app, authAdmin } = buildTestApp({ tenantDb });
    const token = await signTestJwt({ role: "admin" });
    const res = await app.request(`/api/v1/users/${OTHER_USER_ID}`, {
      method: "DELETE",
      headers: bearer(token),
    });
    expect(res.status).toBe(204);
    expect(authAdmin.disabled).toEqual([TEST_AUTH_USER_ID]);
    expect(tenantDb.findQuery(/insert into audit_logs/)?.values?.[2]).toBe("user.removed");

    const self = await app.request(`/api/v1/users/${TEST_USER_ID}`, {
      method: "DELETE",
      headers: token !== "" ? bearer(token) : {},
    });
    expect(self.status).toBe(409);
  });
});

describe("テナント設定・監査ログ・PII 削除（管理者のみ）", () => {
  it("メンバーの GET /tenant・GET /audit-logs・POST /deletion-requests → 403", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const token = await signTestJwt({ role: "member" });
    for (const [path, init] of [
      ["/api/v1/tenant", { headers: bearer(token) }],
      ["/api/v1/audit-logs", { headers: bearer(token) }],
      [
        "/api/v1/deletion-requests",
        {
          method: "POST",
          headers: { ...bearer(token), "content-type": "application/json" },
          body: JSON.stringify({ scope: "entry", entryId: ENTRY_ID, reason: "依頼" }),
        },
      ],
    ] as const) {
      const res = await app.request(path, init as RequestInit);
      expect(res.status, path).toBe(403);
    }
  });

  it("PATCH /tenant は serviceSummary を更新し tenant.settings_updated を記録する", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/update tenants/, [
      {
        id: TEST_TENANT_ID,
        name: "テナント",
        service_summary: "リサーチ自動化 SaaS",
        status: "active",
        created_at: AT,
      },
    ]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/tenant", {
      method: "PATCH",
      headers: {
        ...bearer(await signTestJwt({ role: "admin" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({ serviceSummary: "リサーチ自動化 SaaS" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { serviceSummary: string }).serviceSummary).toBe(
      "リサーチ自動化 SaaS",
    );
    expect(tenantDb.findQuery(/insert into audit_logs/)?.values?.[2]).toBe(
      "tenant.settings_updated",
    );
  });

  it("GET /audit-logs はフィルタ付きで返し、閲覧自体を audit_log.viewed に記録する", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/count\(\*\)::text as n from audit_logs/, [{ n: "1" }]);
    tenantDb.respond(/from audit_logs where/, [
      {
        id: ENTRY_ID,
        actor_user_id: TEST_USER_ID,
        event_type: "list.created",
        resource_type: "CompanyList",
        resource_id: null,
        metadata: {},
        request_id: "req-1",
        occurred_at: AT,
      },
    ]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/audit-logs?eventType=list.created", {
      headers: bearer(await signTestJwt({ role: "admin" })),
    });
    expect(res.status).toBe(200);
    const audit = tenantDb.findQuery(/insert into audit_logs/);
    expect(audit?.values?.[2]).toBe("audit_log.viewed");
    // フィルタが SQL パラメータへ渡ること
    expect(tenantDb.findQuery(/count\(\*\)::text as n from audit_logs/)?.values?.[0]).toBe(
      "list.created",
    );
  });

  it("enum 外の eventType フィルタ → 400", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const res = await app.request("/api/v1/audit-logs?eventType=unknown.event", {
      headers: bearer(await signTestJwt({ role: "admin" })),
    });
    expect(res.status).toBe(400);
  });

  it("PII 削除（scope=entry）: 件数を返し pii.deleted に事実のみ記録する（E4）", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from list_entries where id = \$1/, [{ id: ENTRY_ID }]);
    tenantDb.respond(/count\(\*\)::text as n from dossiers/, [{ n: "1" }]);
    tenantDb.respond(/count\(\*\)::text as n from messages/, [{ n: "2" }]);
    tenantDb.respond(/count\(\*\)::text as n from collected_documents/, [{ n: "3" }]);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/deletion-requests", {
      method: "POST",
      headers: {
        ...bearer(await signTestJwt({ role: "admin" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: "entry", entryId: ENTRY_ID, reason: "本人依頼" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: { dossiers: 1, messages: 2, collectedDocuments: 3, entries: 1 },
    });
    expect(tenantDb.findQuery(/delete from list_entries/)).toBeDefined();
    const audit = tenantDb.findQuery(/insert into audit_logs/);
    expect(audit?.values?.[2]).toBe("pii.deleted");
    const metadata = String(audit?.values?.[5]);
    expect(metadata).toContain('"scope":"entry"');
    expect(metadata).toContain('"entries":1');
  });

  it("PII 削除のスキーマ相関違反（entry なのに entryId なし）→ 400", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor() });
    const res = await app.request("/api/v1/deletion-requests", {
      method: "POST",
      headers: {
        ...bearer(await signTestJwt({ role: "admin" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: "entry", reason: "依頼" }),
    });
    expect(res.status).toBe(400);
  });

  it("PII 削除（scope=company）: エントリなし → 404", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from list_entries where company_id/, []);
    const { app } = buildTestApp({ tenantDb });
    const res = await app.request("/api/v1/deletion-requests", {
      method: "POST",
      headers: {
        ...bearer(await signTestJwt({ role: "admin" })),
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: "company", companyId: COMPANY_ID, reason: "依頼" }),
    });
    expect(res.status).toBe(404);
  });
});
