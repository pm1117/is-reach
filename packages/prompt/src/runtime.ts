// 公開 API の実行コンテキスト。LLM クライアントは注入必須（テスト・呼び出し側から
// モックを渡せる — E2）。config 省略時は設計既定値を使う。
import { defaultPromptConfig, type PromptConfig } from "./config.js";
import type { LlmClient } from "./llm/client.js";
import type { RetryDeps } from "./llm/retry.js";

export interface PromptRuntime extends RetryDeps {
  client: LlmClient;
  config?: PromptConfig;
}

export interface ResolvedRuntime extends RetryDeps {
  client: LlmClient;
  config: PromptConfig;
}

export function resolveRuntime(runtime: PromptRuntime): ResolvedRuntime {
  const resolved: ResolvedRuntime = {
    client: runtime.client,
    config: runtime.config ?? defaultPromptConfig(),
  };
  if (runtime.sleep !== undefined) resolved.sleep = runtime.sleep;
  if (runtime.random !== undefined) resolved.random = runtime.random;
  return resolved;
}
