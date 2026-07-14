// 認可マトリクス（design-detail 2.4 — E3）のテスト。
// (1) 宣言テーブル ROUTE_POLICIES の内容がマトリクスどおりであること
// (2) authorize / registerRoute の機構（ロール不足 403・未宣言ルート fail-closed）
import { apiErrorSchema } from "@is-reach/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createHs256TokenVerifier } from "../src/auth/token-verifier.js";
import { ROUTE_POLICIES, findRoutePolicy } from "../src/auth/route-policies.js";
import { createErrorHandler, notFoundHandler } from "../src/errors.js";
import { authenticate } from "../src/middleware/auth.js";
import { registerRoute } from "../src/middleware/authorize.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import type { AppEnv } from "../src/types.js";
import type { RouteMethod } from "../src/auth/route-policies.js";
import { RecordingLogger, TEST_JWT_SECRET, bearer, signTestJwt } from "./helpers.js";

// design-detail 2.4 で「管理者のみ ×（メンバー不可）」の全操作
const ADMIN_ONLY_ROUTES: [RouteMethod, string][] = [
  ["POST", "/templates"],
  ["PATCH", "/templates/:templateId"],
  ["DELETE", "/templates/:templateId"],
  ["POST", "/users/invitations"],
  ["PATCH", "/users/:userId"],
  ["DELETE", "/users/:userId"],
  ["GET", "/tenant"],
  ["PATCH", "/tenant"],
  ["GET", "/audit-logs"],
  ["POST", "/deletion-requests"],
];

describe("認可マトリクスの宣言テーブル（ROUTE_POLICIES）", () => {
  it("(method, path) の重複がない", () => {
    const keys = ROUTE_POLICIES.map((p) => `${p.method} ${p.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("全ルートに 1 つ以上の許可ロールが宣言されている（空 = 誰も呼べない事故の防止）", () => {
    for (const policy of ROUTE_POLICIES) {
      expect(policy.roles.length, `${policy.method} ${policy.path}`).toBeGreaterThan(0);
    }
  });

  it("管理者専用は 2.4 の 10 ルートのみ。それ以外はすべて admin + member", () => {
    const adminOnlyKeys = new Set(ADMIN_ONLY_ROUTES.map(([m, p]) => `${m} ${p}`));
    for (const policy of ROUTE_POLICIES) {
      const key = `${policy.method} ${policy.path}`;
      if (adminOnlyKeys.has(key)) {
        expect([...policy.roles], key).toEqual(["admin"]);
      } else {
        expect([...policy.roles].sort(), key).toEqual(["admin", "member"]);
      }
    }
    // 逆方向: 管理者専用と宣言すべきルートが表から消えていないこと
    for (const [method, path] of ADMIN_ONLY_ROUTES) {
      expect(findRoutePolicy(method, path), `${method} ${path}`).toBeDefined();
    }
  });

  it("リスト削除（DELETE /lists/:listId）は design-detail 2.2 どおり全員可", () => {
    expect([...(findRoutePolicy("DELETE", "/lists/:listId")?.roles ?? [])].sort()).toEqual([
      "admin",
      "member",
    ]);
  });

  it("GET /me は両ロール可", () => {
    expect([...(findRoutePolicy("GET", "/me")?.roles ?? [])].sort()).toEqual(["admin", "member"]);
  });
});

/** registerRoute で管理者専用ルートのスタブを立てたテストアプリ */
function buildAuthorizeTestApp() {
  const app = new Hono<AppEnv>();
  app.use("*", requestIdMiddleware());
  app.onError(createErrorHandler(new RecordingLogger()));
  app.notFound(notFoundHandler);

  const v1 = new Hono<AppEnv>();
  v1.use("*", authenticate(createHs256TokenVerifier(TEST_JWT_SECRET)));
  registerRoute(v1, "GET", "/me", (c) => c.json({ ok: true }));
  registerRoute(v1, "POST", "/templates", (c) => c.json({ ok: true }));
  registerRoute(v1, "DELETE", "/lists/:listId", (c) => c.json({ ok: true }));
  app.route("/api/v1", v1);
  return app;
}

describe("認可ミドルウェア（authorize / registerRoute）", () => {
  it("管理者専用ルートにメンバー → 403 AUTH_FORBIDDEN", async () => {
    const app = buildAuthorizeTestApp();
    const token = await signTestJwt({ role: "member" });
    const res = await app.request("/api/v1/templates", {
      method: "POST",
      headers: bearer(token),
    });
    expect(res.status).toBe(403);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("管理者専用ルートに管理者 → 通過", async () => {
    const app = buildAuthorizeTestApp();
    const token = await signTestJwt({ role: "admin" });
    const res = await app.request("/api/v1/templates", {
      method: "POST",
      headers: bearer(token),
    });
    expect(res.status).toBe(200);
  });

  it.each(["admin", "member"] as const)("GET /me は %s ロールで通過", async (role) => {
    const app = buildAuthorizeTestApp();
    const token = await signTestJwt({ role });
    const res = await app.request("/api/v1/me", { headers: bearer(token) });
    expect(res.status).toBe(200);
  });

  it.each(["admin", "member"] as const)(
    "リスト削除は %s ロールで通過（2.2: 全員）",
    async (role) => {
      const app = buildAuthorizeTestApp();
      const token = await signTestJwt({ role });
      const res = await app.request("/api/v1/lists/3f8e9d2a-6b4c-4d5e-9f1a-2b3c4d5e6f70", {
        method: "DELETE",
        headers: bearer(token),
      });
      expect(res.status).toBe(200);
    },
  );

  it("宣言テーブルにないルートの登録は例外（fail-closed）", () => {
    const v1 = new Hono<AppEnv>();
    expect(() => registerRoute(v1, "GET", "/undeclared", (c) => c.json({ ok: true }))).toThrowError(
      /認可マトリクス未宣言のルート: GET \/undeclared/,
    );
  });
});
