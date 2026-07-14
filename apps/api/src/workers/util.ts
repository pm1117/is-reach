// ワーカー共通ユーティリティ: フェーズタイムアウトとジョブ失敗の分類。
import { PromptError } from "@is-reach/prompt";
import type { ErrorCode } from "@is-reach/shared";
import { ZodError } from "zod";

/**
 * ジョブの業務失敗（deep_dive_jobs / message_jobs の error jsonb へ写す）。
 * permanent = true はジョブレベル自動リトライで回復しない失敗（即 failed にする）。
 */
export class JobFailure extends Error {
  readonly code: ErrorCode;
  readonly permanent: boolean;

  constructor(code: ErrorCode, message: string, options?: { permanent?: boolean }) {
    super(message);
    this.name = "JobFailure";
    this.code = code;
    this.permanent = options?.permanent ?? false;
  }
}

/** 例外を JobFailure に正規化する（エラーメッセージに外部データ本文を含めない前提） */
export function toJobFailure(error: unknown): JobFailure {
  if (error instanceof JobFailure) return error;
  if (error instanceof PromptError) {
    // LLM_UNAVAILABLE / LLM_OUTPUT_INVALID / INTERNAL（design-detail 4.3）
    return new JobFailure(error.code, error.message);
  }
  if (error instanceof ZodError) {
    // 入力契約の不整合 = リトライで回復しない
    return new JobFailure("INTERNAL", "ジョブ入力が契約に適合しません", { permanent: true });
  }
  if (error instanceof Error) {
    return new JobFailure("INTERNAL", error.message);
  }
  return new JobFailure("INTERNAL", String(error));
}

/**
 * promise にフェーズタイムアウトを課す（design-detail 4.1: collecting 10 分 / analyzing 3 分）。
 * 注意: タイムアウト時も元の処理はキャンセルされない（放置）。ジョブ全体の上限は
 * pg-boss の expireInSeconds（15 分）が最終防衛線になる。
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
