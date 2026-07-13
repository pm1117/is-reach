import { describe, expect, it } from "vitest";
import { apiErrorSchema, paginatedResponseSchema, paginationQuerySchema } from "../src/index.js";
import { z } from "zod";

describe("apiErrorSchema（design-detail 2.5 標準形）", () => {
  it("正常系（details は省略可）", () => {
    const parsed = apiErrorSchema.parse({
      error: {
        code: "VALIDATION_FAILED",
        message: "リクエストの検証に失敗しました",
        details: { fieldErrors: { name: ["必須です"] } },
        requestId: "req_123",
      },
    });
    expect(parsed.error.code).toBe("VALIDATION_FAILED");

    expect(
      apiErrorSchema.safeParse({
        error: { code: "INTERNAL", message: "内部エラー", requestId: "req_1" },
      }).success,
    ).toBe(true);
  });

  it("体系外コード・requestId 欠落・空 message を拒否する", () => {
    expect(
      apiErrorSchema.safeParse({
        error: { code: "UNKNOWN_CODE", message: "x", requestId: "r" },
      }).success,
    ).toBe(false);
    expect(apiErrorSchema.safeParse({ error: { code: "INTERNAL", message: "x" } }).success).toBe(
      false,
    );
    expect(
      apiErrorSchema.safeParse({
        error: { code: "INTERNAL", message: "", requestId: "r" },
      }).success,
    ).toBe(false);
  });
});

describe("paginationQuerySchema（limit 既定 50・最大 200）", () => {
  it("未指定なら既定値 limit=50 / offset=0", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("クエリ文字列（string）から coerce する", () => {
    expect(paginationQuerySchema.parse({ limit: "100", offset: "20" })).toEqual({
      limit: 100,
      offset: 20,
    });
  });

  it("境界値: limit 200 受理・201 拒否・0 拒否、offset 負数拒否", () => {
    expect(paginationQuerySchema.safeParse({ limit: 200 }).success).toBe(true);
    expect(paginationQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: "abc" }).success).toBe(false);
  });
});

describe("paginatedResponseSchema", () => {
  it("`{ items, total }` の形を強制する", () => {
    const schema = paginatedResponseSchema(z.object({ id: z.string() }));
    expect(schema.parse({ items: [{ id: "a" }], total: 1 }).items).toHaveLength(1);
    expect(schema.safeParse({ items: [{ id: 1 }], total: 1 }).success).toBe(false);
    expect(schema.safeParse({ items: [], total: -1 }).success).toBe(false);
    expect(schema.safeParse({ items: [] }).success).toBe(false);
  });
});
