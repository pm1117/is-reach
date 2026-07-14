// GET /api/v1/me の縦貫通テスト: JWT → 認可 → withTenantContext（RLS 経路）→ 契約レスポンス。
import { apiErrorSchema, meResponseSchema } from "@is-reach/shared";
import { describe, expect, it } from "vitest";
import {
  TEST_AUTH_USER_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  bearer,
  buildTestApp,
  meRow,
  signTestJwt,
} from "./helpers.js";

describe("GET /api/v1/me", () => {
  it("meResponseSchema に適合するレスポンスを返す", async () => {
    const { app, tenantDb } = buildTestApp({ rows: [meRow()] });
    const token = await signTestJwt({ role: "member" });
    const res = await app.request("/api/v1/me", { headers: bearer(token) });

    expect(res.status).toBe(200);
    const body = meResponseSchema.parse(await res.json());
    expect(body).toEqual({
      user: {
        id: TEST_USER_ID,
        email: "user@example.com",
        displayName: "担当者",
        role: "member",
      },
      tenant: { id: TEST_TENANT_ID, name: "テストテナント" },
    });

    // テナントコンテキストは JWT の tenant_id、検索キーは JWT の sub（auth_user_id）
    expect(tenantDb.contexts).toEqual([TEST_TENANT_ID]);
    expect(tenantDb.queries[0]?.values).toEqual([TEST_AUTH_USER_ID]);
    expect(tenantDb.queries[0]?.text).toMatch(/invitation_status = 'active'/);
  });

  it("users 行がない（招待未受諾・無効化済み）→ 404 RESOURCE_NOT_FOUND", async () => {
    const { app } = buildTestApp({ rows: [] });
    const token = await signTestJwt();
    const res = await app.request("/api/v1/me", { headers: bearer(token) });
    expect(res.status).toBe(404);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("DB の値が契約と食い違う（enum 外ロール）→ 500 INTERNAL（400 にしない・詳細はログのみ）", async () => {
    const { app, logger } = buildTestApp({ rows: [meRow({ role: "superuser" })] });
    const token = await signTestJwt();
    const res = await app.request("/api/v1/me", { headers: bearer(token) });
    expect(res.status).toBe(500);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("superuser");
    expect(logger.errors).toHaveLength(1);
    expect(JSON.stringify(logger.errors[0])).toContain("契約に適合しません");
  });
});
