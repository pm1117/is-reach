// V1: 構造化出力の zod 検証と再試行フロー（design-detail 3.5 V1 / 4.3）。
//
// - LLM 呼び出しは callWithRetry（E11 のトランスポート層リトライ）を通す
// - V1 失敗時は「同一入力 + 誤り箇所を指摘する固定文」で 1 回だけ再試行する
//   （外部データは再サニタイズ済みのものを再利用 = 同じ userText を使う）
// - 再失敗で PromptError(LLM_OUTPUT_INVALID)
import type { z } from "zod";
import type { PromptConfig } from "./config.js";
import { PromptError } from "./errors.js";
import type { LlmClient, LlmRequest } from "./llm/client.js";
import { callWithRetry, type RetryDeps } from "./llm/retry.js";
import { buildV1RetryNotice } from "./prompts.js";

export interface StructuredCallResult<T> {
  output: T;
  modelId: string;
}

/**
 * 構造化出力を要求し、V1（zod）検証と 1 回だけの再試行を行う。
 * 注意: エラーメッセージに LLM 出力の値・外部データ本文を含めない（フィールドパスのみ）。
 */
export async function callStructured<T>(
  client: LlmClient,
  request: LlmRequest,
  schema: z.ZodType<T>,
  retry: PromptConfig["retry"],
  deps: RetryDeps = {},
): Promise<StructuredCallResult<T>> {
  const first = await callWithRetry(client, request, retry, deps);
  const firstParsed = schema.safeParse(first.toolInput);
  if (firstParsed.success) {
    return { output: firstParsed.data, modelId: first.modelId };
  }

  // 再試行（1 回だけ）: 同一入力に固定の指摘文を追加する
  const issuePaths = issuePathsOf(firstParsed.error);
  const retryRequest: LlmRequest = {
    ...request,
    userText: `${request.userText}\n\n${buildV1RetryNotice(issuePaths)}`,
  };
  const second = await callWithRetry(client, retryRequest, retry, deps);
  const secondParsed = schema.safeParse(second.toolInput);
  if (secondParsed.success) {
    return { output: secondParsed.data, modelId: second.modelId };
  }

  throw new PromptError(
    "LLM_OUTPUT_INVALID",
    `構造化出力の検証に再試行後も失敗した（誤りフィールド: ${issuePathsOf(secondParsed.error).join(", ") || "(スキーマ全体)"}）`,
  );
}

/** ZodError から誤り箇所のフィールドパスだけを取り出す（出力値は含めない） */
function issuePathsOf(error: z.ZodError): string[] {
  const paths = error.issues.map((issue) =>
    issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
  );
  return [...new Set(paths)];
}
