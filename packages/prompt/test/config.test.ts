// 設定（E2: モデル ID・max_tokens・タイムアウトは環境設定値）。
import { describe, expect, it } from "vitest";
import { defaultPromptConfig, promptConfigFromEnv } from "../src/index.js";

describe("defaultPromptConfig", () => {
  it("設計の決定値・提案値が既定になる", () => {
    const config = defaultPromptConfig();
    expect(config.dossier).toEqual({
      modelId: "claude-sonnet-5",
      maxTokens: 4_096,
      timeoutMs: 120_000, // E11: ドシエ分析 120 秒
    });
    expect(config.message).toEqual({
      modelId: "claude-haiku-4-5",
      maxTokens: 1_024,
      timeoutMs: 60_000, // E11: メッセージ生成 60 秒
    });
    expect(config.retry).toEqual({
      initialDelayMs: 2_000,
      factor: 2,
      maxRateLimitRetries: 5,
      maxServerErrorRetries: 3,
    });
    expect(config.limits.perSourceChars).toBe(30_000); // S4
    expect(config.limits.dossierTotalChars).toBe(120_000); // S5
    expect(config.limits.messageTotalChars).toBe(8_000); // S5
  });
});

describe("promptConfigFromEnv", () => {
  it("環境変数でモデル ID・max_tokens・タイムアウトを差し替えられる（E2）", () => {
    const config = promptConfigFromEnv({
      PROMPT_DOSSIER_MODEL_ID: "claude-sonnet-next",
      PROMPT_DOSSIER_TIMEOUT_MS: "90000",
      PROMPT_MESSAGE_MAX_TOKENS: "2048",
    });
    expect(config.dossier.modelId).toBe("claude-sonnet-next");
    expect(config.dossier.timeoutMs).toBe(90_000);
    expect(config.dossier.maxTokens).toBe(4_096); // 未指定は既定値
    expect(config.message.maxTokens).toBe(2_048);
    expect(config.message.modelId).toBe("claude-haiku-4-5");
  });

  it("空文字は未指定として扱う", () => {
    const config = promptConfigFromEnv({ PROMPT_DOSSIER_MODEL_ID: "" });
    expect(config.dossier.modelId).toBe("claude-sonnet-5");
  });

  it("数値系の環境変数が整数でなければ拒否する（外部入力のスキーマ検証）", () => {
    expect(() => promptConfigFromEnv({ PROMPT_DOSSIER_TIMEOUT_MS: "abc" })).toThrow();
    expect(() => promptConfigFromEnv({ PROMPT_MESSAGE_MAX_TOKENS: "-1" })).toThrow();
    expect(() => promptConfigFromEnv({ PROMPT_MESSAGE_MAX_TOKENS: "1.5" })).toThrow();
  });
});
