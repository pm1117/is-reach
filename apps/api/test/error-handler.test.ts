// エラー標準形（design-detail 2.5 — E5）への正規化テスト。
// ApiHttpError / ZodError / 未分類エラー / ルート未定義の 4 系統を検証する。
import { apiErrorSchema } from "@is-reach/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiHttpError,
  createErrorHandler,
  notFoundHandler,
  validationError,
} from "../src/errors.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import type { AppEnv } from "../src/types.js";
import { RecordingLogger } from "./helpers.js";

function buildErrorTestApp() {
  const logger = new RecordingLogger();
  const app = new Hono<AppEnv>();
  app.use("*", requestIdMiddleware());
  app.onError(createErrorHandler(logger));
  app.notFound(notFoundHandler);

  app.get("/boom-api-error", () => {
    throw new ApiHttpError("JOB_ALREADY_RUNNING", "実行中のジョブがあります", {
      entryId: "e-1",
    });
  });
  app.post("/boom-validation", async (c) => {
    const schema = z.object({ name: z.string().min(1) });
    const parsed = schema.safeParse(await c.req.json());
    if (!parsed.success) throw validationError(parsed.error);
    return c.json(parsed.data);
  });
  app.get("/boom-raw-zod", () => {
    z.object({ id: z.uuid() }).parse({ id: "broken" });
    return undefined as never;
  });
  app.get("/boom-internal", () => {
    throw new Error("接続文字列 postgres://secret 込みの内部詳細");
  });
  return { app, logger };
}

describe("グローバルエラーハンドラ（2.5 標準形）", () => {
  it("ApiHttpError はコード対応表どおりのステータスと標準形で返る", async () => {
    const { app } = buildErrorTestApp();
    const res = await app.request("/boom-api-error");
    expect(res.status).toBe(409);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("JOB_ALREADY_RUNNING");
    expect(body.error.message).toBe("実行中のジョブがあります");
    expect(body.error.details).toEqual({ entryId: "e-1" });
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("zod 検証失敗 → 400 VALIDATION_FAILED（details に失敗フィールド）", async () => {
    const { app } = buildErrorTestApp();
    const res = await app.request("/boom-validation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toMatchObject({
      issues: [expect.objectContaining({ path: "name" })],
    });
  });

  it("生の ZodError が漏れてきても 400 VALIDATION_FAILED に正規化される", async () => {
    const { app } = buildErrorTestApp();
    const res = await app.request("/boom-raw-zod");
    expect(res.status).toBe(400);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("未分類エラー → 500 INTERNAL。詳細はログのみでレスポンスへ漏らさない", async () => {
    const { app, logger } = buildErrorTestApp();
    const res = await app.request("/boom-internal");
    expect(res.status).toBe(500);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("内部エラーが発生しました");
    expect(JSON.stringify(body)).not.toContain("postgres://secret");
    // ログには詳細と requestId が残る（相関可能）
    expect(logger.errors).toHaveLength(1);
    expect(JSON.stringify(logger.errors[0])).toContain("postgres://secret");
    expect(JSON.stringify(logger.errors[0])).toContain(body.error.requestId);
  });

  it("ルート未定義 → 404 RESOURCE_NOT_FOUND", async () => {
    const { app } = buildErrorTestApp();
    const res = await app.request("/no-such-route");
    expect(res.status).toBe(404);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });
});
