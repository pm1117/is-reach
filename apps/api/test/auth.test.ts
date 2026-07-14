// JWT 検証 → テナントコンテキスト解決（middleware/auth.ts）のテスト。
// 有効 / 無効署名 / 期限切れ / app_metadata 欠落・不正の各ケースを
// GET /api/v1/me への実リクエストで検証する（エラー標準形 2.5 も同時に確認）。
import { apiErrorSchema } from "@is-reach/shared";
import { describe, expect, it } from "vitest";
import { TEST_TENANT_ID, bearer, buildTestApp, signTestJwt } from "./helpers.js";

async function expectUnauthenticated(res: Response): Promise<void> {
  expect(res.status).toBe(401);
  const body = apiErrorSchema.parse(await res.json());
  expect(body.error.code).toBe("AUTH_UNAUTHENTICATED");
  expect(body.error.requestId).not.toHaveLength(0);
}

describe("認証ミドルウェア（Supabase Auth JWT — basic-design 7.1）", () => {
  it("有効な JWT でテナントコンテキストが解決され 200", async () => {
    const { app, tenantDb } = buildTestApp();
    const token = await signTestJwt({ role: "member" });
    const res = await app.request("/api/v1/me", { headers: bearer(token) });
    expect(res.status).toBe(200);
    // JWT の app_metadata.tenant_id が withTenantContext にそのまま渡ること
    expect(tenantDb.contexts).toEqual([TEST_TENANT_ID]);
  });

  it("Authorization ヘッダなし → 401 AUTH_UNAUTHENTICATED", async () => {
    const { app } = buildTestApp();
    await expectUnauthenticated(await app.request("/api/v1/me"));
  });

  it("Bearer 形式でないヘッダ → 401", async () => {
    const { app } = buildTestApp();
    const res = await app.request("/api/v1/me", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    await expectUnauthenticated(res);
  });

  it("JWT でない文字列 → 401", async () => {
    const { app } = buildTestApp();
    const res = await app.request("/api/v1/me", { headers: bearer("not-a-jwt") });
    await expectUnauthenticated(res);
  });

  it("別シークレットで署名された JWT → 401", async () => {
    const { app } = buildTestApp();
    const token = await signTestJwt({
      secret: "another-secret-another-secret-another-secret",
    });
    await expectUnauthenticated(await app.request("/api/v1/me", { headers: bearer(token) }));
  });

  it("期限切れ JWT → 401", async () => {
    const { app } = buildTestApp();
    const token = await signTestJwt({ expiresAt: Math.floor(Date.now() / 1000) - 3600 });
    await expectUnauthenticated(await app.request("/api/v1/me", { headers: bearer(token) }));
  });

  it("app_metadata 欠落 → 401（テナントコンテキストを解決できない）", async () => {
    const { app, tenantDb } = buildTestApp();
    const token = await signTestJwt({ omitAppMetadata: true });
    await expectUnauthenticated(await app.request("/api/v1/me", { headers: bearer(token) }));
    expect(tenantDb.contexts).toHaveLength(0); // DB アクセスに到達しない
  });

  it("app_metadata.tenant_id が UUID でない → 401", async () => {
    const { app } = buildTestApp();
    const token = await signTestJwt({
      appMetadata: { tenant_id: "not-a-uuid", role: "member" },
    });
    await expectUnauthenticated(await app.request("/api/v1/me", { headers: bearer(token) }));
  });

  it("app_metadata.role が enum 外 → 401", async () => {
    const { app } = buildTestApp();
    const token = await signTestJwt({
      appMetadata: { tenant_id: TEST_TENANT_ID, role: "superadmin" },
    });
    await expectUnauthenticated(await app.request("/api/v1/me", { headers: bearer(token) }));
  });
});
