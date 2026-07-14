// リクエスト ID ミドルウェアのテスト: 生成・レスポンスヘッダ・エラー標準形との相関・
// 外部からの x-request-id 偽装の不採用。
import { apiErrorSchema } from "@is-reach/shared";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("リクエスト ID（2.5 requestId 相関）", () => {
  it("すべてのレスポンスに x-request-id ヘッダ（UUID）が付く", async () => {
    const { app } = buildTestApp();
    const res = await app.request("/api/v1/me");
    expect(res.headers.get("x-request-id")).toMatch(UUID_PATTERN);
  });

  it("リクエストごとに異なる ID が振られる", async () => {
    const { app } = buildTestApp();
    const first = await app.request("/api/v1/me");
    const second = await app.request("/api/v1/me");
    expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"));
  });

  it("エラーレスポンスの error.requestId とヘッダが一致する（ログ相関）", async () => {
    const { app } = buildTestApp();
    const res = await app.request("/api/v1/me"); // 未認証 → 401
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("外部から送られた x-request-id は採用しない（なりすまし防止）", async () => {
    const { app } = buildTestApp();
    const res = await app.request("/api/v1/me", {
      headers: { "x-request-id": "attacker-chosen-id" },
    });
    expect(res.headers.get("x-request-id")).not.toBe("attacker-chosen-id");
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.requestId).not.toBe("attacker-chosen-id");
  });
});
