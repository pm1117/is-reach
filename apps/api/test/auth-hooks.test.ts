// ログインイベント webhook（design-detail 5 章の仮置き第一候補 — 人間確認対象）。
// 共有シークレット保護・未設定時の無効化・user.login 監査ログ記録を検証する。
import { describe, expect, it } from "vitest";
import { AUTH_HOOK_HEADER, AUTH_HOOK_PATH } from "../src/routes/auth-hooks.js";
import {
  TEST_AUTH_USER_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  buildTestApp,
  tenantDbWithActor,
} from "./helpers.js";

const SECRET = "auth-hook-secret-0123456789abcdef0123456789abcdef";

function hookBody() {
  return JSON.stringify({
    user: { id: TEST_AUTH_USER_ID, app_metadata: { tenant_id: TEST_TENANT_ID } },
  });
}

describe("POST /internal/hooks/login", () => {
  it("AUTH_HOOK_SECRET 未設定ならエンドポイント自体が存在しない（404）", async () => {
    const { app } = buildTestApp({ authHookSecret: null });
    const res = await app.request(AUTH_HOOK_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: hookBody(),
    });
    expect(res.status).toBe(404);
  });

  it("シークレット不一致 → 401（DB へ到達しない）", async () => {
    const tenantDb = tenantDbWithActor();
    const { app } = buildTestApp({ tenantDb, authHookSecret: SECRET });
    const res = await app.request(AUTH_HOOK_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", [AUTH_HOOK_HEADER]: "wrong" },
      body: hookBody(),
    });
    expect(res.status).toBe(401);
    expect(tenantDb.contexts).toHaveLength(0);
  });

  it("正しいシークレット → 204 + user.login 監査ログ（actor は users 行から解決）", async () => {
    const tenantDb = tenantDbWithActor();
    tenantDb.respond(/select id from users where auth_user_id/, [{ id: TEST_USER_ID }]);
    const { app } = buildTestApp({ tenantDb, authHookSecret: SECRET });
    const res = await app.request(AUTH_HOOK_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", [AUTH_HOOK_HEADER]: SECRET },
      body: hookBody(),
    });
    expect(res.status).toBe(204);
    expect(tenantDb.contexts).toEqual([TEST_TENANT_ID]);
    const audit = tenantDb.findQuery(/insert into audit_logs/);
    expect(audit?.values?.[2]).toBe("user.login");
    expect(audit?.values?.[1]).toBe(TEST_USER_ID);
  });

  it("payload の形が不正（tenant_id 欠落）→ 400", async () => {
    const { app } = buildTestApp({ tenantDb: tenantDbWithActor(), authHookSecret: SECRET });
    const res = await app.request(AUTH_HOOK_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", [AUTH_HOOK_HEADER]: SECRET },
      body: JSON.stringify({ user: { id: TEST_AUTH_USER_ID, app_metadata: {} } }),
    });
    expect(res.status).toBe(400);
  });
});
