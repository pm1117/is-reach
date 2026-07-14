// API クライアント: shared の型契約でのレスポンス検証と ApiError 標準形（design-detail 2.5）のパース
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClient, ApiClientError } from "@/lib/api/client";
import { fetchMe } from "@/lib/api/me";
import { makeMe } from "./helpers";

const itemSchema = z.object({ id: z.string() });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(fetchFn: typeof fetch, token: string | null = "test-jwt") {
  return new ApiClient({
    baseUrl: "https://api.example.com/api/v1",
    getAccessToken: async () => token,
    fetchFn,
  });
}

async function captureError(promise: Promise<unknown>): Promise<ApiClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiClientError);
    return error as ApiClientError;
  }
  throw new Error("ApiClientError が throw されなかった");
}

describe("ApiClient", () => {
  it("正常レスポンスをスキーマ検証して返す", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "a" }));
    const result = await makeClient(fetchFn).request("/items/a", itemSchema);
    expect(result).toEqual({ id: "a" });
  });

  it("ベース URL とパスを結合し Authorization ヘッダーに JWT を付与する", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "a" }));
    await makeClient(fetchFn).request("/items/a", itemSchema);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/v1/items/a");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-jwt");
  });

  it("未認証（トークン null）のときは Authorization ヘッダーを付けない", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "a" }));
    await makeClient(fetchFn, null).request("/items/a", itemSchema);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("エラー標準形（design-detail 2.5）をパースし code / requestId / status を保持する", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "AUTH_FORBIDDEN",
            message: "この操作は許可されていません",
            requestId: "req-123",
          },
        },
        403,
      ),
    );
    const error = await captureError(makeClient(fetchFn).request("/templates", itemSchema));
    expect(error.code).toBe("AUTH_FORBIDDEN");
    expect(error.requestId).toBe("req-123");
    expect(error.status).toBe(403);
    expect(error.message).toBe("この操作は許可されていません");
  });

  it("details 付きのエラー標準形も保持する", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "入力が不正です",
            requestId: "req-9",
            details: { field: "name" },
          },
        },
        400,
      ),
    );
    const error = await captureError(makeClient(fetchFn).request("/lists", itemSchema));
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.details).toEqual({ field: "name" });
  });

  it("標準形でないエラーボディは INVALID_RESPONSE として status を保持する", async () => {
    const fetchFn = vi.fn(async () => new Response("<html>Bad Gateway</html>", { status: 502 }));
    const error = await captureError(makeClient(fetchFn).request("/me", itemSchema));
    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.status).toBe(502);
    expect(error.requestId).toBeNull();
  });

  it("接続失敗は NETWORK_ERROR（status なし）", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await captureError(makeClient(fetchFn).request("/me", itemSchema));
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.status).toBeNull();
  });

  it("スキーマに合わない成功レスポンスは INVALID_RESPONSE", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ unexpected: true }));
    const error = await captureError(makeClient(fetchFn).request("/items/a", itemSchema));
    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.status).toBe(200);
  });

  it("requestVoid は 204 レスポンスを受理する", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      makeClient(fetchFn).requestVoid("/messages/m1/copy-events", { method: "POST" }),
    ).resolves.toBeUndefined();
  });

  it("fetchMe は shared の meResponseSchema で検証して返す", async () => {
    const me = makeMe("admin");
    const fetchFn = vi.fn(async () => jsonResponse(me));
    await expect(fetchMe(makeClient(fetchFn))).resolves.toEqual(me);

    const badFetch = vi.fn(async () => jsonResponse({ user: { id: "x" } }));
    const error = await captureError(fetchMe(makeClient(badFetch)));
    expect(error.code).toBe("INVALID_RESPONSE");
  });
});
