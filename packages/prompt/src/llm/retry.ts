// LLM リトライ（design-detail 4.3 — 決定 E11）。
//
// | 事象            | 扱い                                                                 |
// | 429 / 529       | 指数バックオフ: 初回 2 秒・係数 2・フルジッター・最大 5 回 → LLM_UNAVAILABLE |
// | 5xx / 接続エラー | 同バックオフで最大 3 回 → LLM_UNAVAILABLE                               |
// | 400             | リトライしない。即 failed（INTERNAL — 設計バグとして扱う）                 |
//
// フルジッター: 待機時間 = random() * (initialDelayMs * factor^試行回数)。
// sleep / random は注入可能（テストでフェイクタイマー・乱数固定を使うため）。
import type { PromptConfig } from "../config.js";
import { LlmTransportError, PromptError } from "../errors.js";
import type { LlmClient, LlmRequest, LlmResponse } from "./client.js";

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * E11 のリトライ方針で LLM を呼び出す。
 * リトライ上限到達で PromptError(LLM_UNAVAILABLE)、400 で PromptError(INTERNAL) を投げる。
 */
export async function callWithRetry(
  client: LlmClient,
  request: LlmRequest,
  retry: PromptConfig["retry"],
  deps: RetryDeps = {},
): Promise<LlmResponse> {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  let rateLimitRetries = 0;
  let serverErrorRetries = 0;

  // 進行保証: 各イテレーションでいずれかのカウンタが増えるか return / throw する
  for (;;) {
    try {
      return await client.complete(request);
    } catch (error) {
      if (!(error instanceof LlmTransportError)) throw error;

      switch (error.kind) {
        case "rate_limited":
        case "overloaded": {
          if (rateLimitRetries >= retry.maxRateLimitRetries) {
            throw new PromptError(
              "LLM_UNAVAILABLE",
              `LLM の過負荷・レート制限が解消しなかった（リトライ ${rateLimitRetries} 回）`,
              { cause: error },
            );
          }
          await sleep(fullJitterDelay(retry, rateLimitRetries, random));
          rateLimitRetries += 1;
          break;
        }
        // design-detail 4.3 はタイムアウトのリトライ回数を明示していないため、
        // 一過性障害として 5xx / 接続エラーと同じ「最大 3 回」グループに分類する（実装判断）
        case "server_error":
        case "connection_error":
        case "timeout": {
          if (serverErrorRetries >= retry.maxServerErrorRetries) {
            throw new PromptError(
              "LLM_UNAVAILABLE",
              `LLM のサーバーエラー・接続エラーが解消しなかった（リトライ ${serverErrorRetries} 回）`,
              { cause: error },
            );
          }
          await sleep(fullJitterDelay(retry, serverErrorRetries, random));
          serverErrorRetries += 1;
          break;
        }
        case "invalid_request":
          // 400 はリトライ禁止（E11）。外部データ本文はメッセージに含まれない（errors.ts）
          throw new PromptError(
            "INTERNAL",
            `LLM リクエストが不正（リトライ禁止・設計バグとして扱う）: ${error.message}`,
            { cause: error },
          );
      }
    }
  }
}

/** フルジッター付き指数バックオフの待機時間（attempt は 0 始まり） */
function fullJitterDelay(
  retry: PromptConfig["retry"],
  attempt: number,
  random: () => number,
): number {
  const cap = retry.initialDelayMs * retry.factor ** attempt;
  return random() * cap;
}
