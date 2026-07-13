// LLM リトライ（design-detail 4.3 — E11）。実タイマー・実 API を使わず、
// sleep / random を注入して回数・待機時間・ジッター範囲を検証する。
import { describe, expect, it } from "vitest";
import {
  callWithRetry,
  defaultPromptConfig,
  LlmTransportError,
  PromptError,
  type LlmRequest,
} from "../src/index.js";
import { FakeLlmClient, ok } from "./helpers.js";

const request: LlmRequest = {
  model: "test-model",
  maxTokens: 100,
  timeoutMs: 1_000,
  system: "system",
  userText: "user",
  tool: { name: "t", description: "d", inputSchema: { type: "object" } },
};

const retryConfig = defaultPromptConfig().retry;

function transportError(kind: ConstructorParameters<typeof LlmTransportError>[0]): {
  error: LlmTransportError;
} {
  return { error: new LlmTransportError(kind, `test ${kind}`) };
}

describe("callWithRetry: 429 / 529（指数バックオフ + フルジッター・最大 5 回）", () => {
  it("429 が続くと初回 2 秒・係数 2 のバックオフで最大 5 回リトライし LLM_UNAVAILABLE", async () => {
    const sleeps: number[] = [];
    const client = new FakeLlmClient(
      Array.from({ length: 6 }, () => transportError("rate_limited")),
    );

    await expect(
      callWithRetry(client, request, retryConfig, {
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
        random: () => 1, // ジッター上限側に固定して基準値を検証する
      }),
    ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });

    // 初回呼び出し + 5 リトライ = 6 回
    expect(client.requests).toHaveLength(6);
    expect(sleeps).toEqual([2_000, 4_000, 8_000, 16_000, 32_000]);
  });

  it("フルジッター: 待機時間は 0〜（2秒 × 2^試行回数）の範囲に一様分布する", async () => {
    const sleeps: number[] = [];
    const client = new FakeLlmClient([
      transportError("overloaded"),
      transportError("overloaded"),
      ok({ any: true }),
    ]);

    await callWithRetry(client, request, retryConfig, {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
    });

    expect(sleeps).toEqual([1_000, 2_000]); // 0.5 * 2000, 0.5 * 4000
  });

  it("途中で成功すればその応答を返す", async () => {
    const client = new FakeLlmClient([transportError("rate_limited"), ok({ v: 1 }, "m")]);
    const response = await callWithRetry(client, request, retryConfig, {
      sleep: () => Promise.resolve(),
      random: () => 0,
    });
    expect(response).toEqual({ toolInput: { v: 1 }, modelId: "m" });
  });
});

describe("callWithRetry: 5xx / 接続エラー（最大 3 回）", () => {
  it.each(["server_error", "connection_error", "timeout"] as const)(
    "%s は最大 3 回リトライして LLM_UNAVAILABLE",
    async (kind) => {
      const client = new FakeLlmClient(Array.from({ length: 4 }, () => transportError(kind)));
      await expect(
        callWithRetry(client, request, retryConfig, {
          sleep: () => Promise.resolve(),
          random: () => 0,
        }),
      ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });
      expect(client.requests).toHaveLength(4); // 初回 + 3 リトライ
    },
  );
});

describe("callWithRetry: 400（リトライ禁止）", () => {
  it("即 failed（INTERNAL）でリトライしない", async () => {
    const client = new FakeLlmClient([transportError("invalid_request")]);
    await expect(
      callWithRetry(client, request, retryConfig, {
        sleep: () => {
          throw new Error("400 で sleep してはならない");
        },
      }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(client.requests).toHaveLength(1);
  });

  it("エラーメッセージに外部データ本文（userText）を含めない", async () => {
    const client = new FakeLlmClient([transportError("invalid_request")]);
    const secret = "SECRET-EXTERNAL-CONTENT";
    try {
      await callWithRetry(client, { ...request, userText: secret }, retryConfig, {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PromptError);
      expect((error as PromptError).message).not.toContain(secret);
    }
  });
});

describe("callWithRetry: LlmTransportError 以外はそのまま透過する", () => {
  it("想定外の例外はリトライせず再送出する", async () => {
    const client = new FakeLlmClient([{ error: new Error("bug") }]);
    await expect(callWithRetry(client, request, retryConfig, {})).rejects.toThrow("bug");
    expect(client.requests).toHaveLength(1);
  });
});
