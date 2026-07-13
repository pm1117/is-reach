// prompt パッケージのエラー型（design-detail 4.3 / 2.5 のエラーコード体系に合わせる）。
//
// セキュリティ注意（E11）: PromptError / LlmTransportError の message には
// 外部データ本文・プロンプト全文を絶対に含めない（ログへ外部データを残さないため）。
// 参照（モデル ID・試行回数・HTTP ステータス等）のみを含める。
import type { ErrorCode } from "@is-reach/shared";

/** LLM 呼び出しの失敗分類（design-detail 4.3 の行に対応） */
export type LlmFailureKind =
  | "rate_limited" // 429
  | "overloaded" // 529
  | "server_error" // 5xx
  | "connection_error" // DNS / 接続断
  | "timeout" // クライアント側タイムアウト（E11 のタイムアウト値超過）
  | "invalid_request"; // 400（リトライ禁止 — 設計バグとして扱う）

/**
 * LLM トランスポート層のエラー。LlmClient 実装（Anthropic アダプタ / テストのモック）が投げ、
 * リトライ層（retry.ts）が kind で分類して 4.3 の方針を適用する。
 */
export class LlmTransportError extends Error {
  readonly kind: LlmFailureKind;
  /** HTTP ステータス（接続エラー等で不明なら undefined） */
  readonly status: number | undefined;

  constructor(kind: LlmFailureKind, message: string, status?: number) {
    super(message);
    this.name = "LlmTransportError";
    this.kind = kind;
    this.status = status;
  }
}

/** prompt パッケージ公開 API の失敗（ジョブの error.code へそのまま写せるコードを持つ） */
export class PromptError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PromptError";
    this.code = code;
  }
}
