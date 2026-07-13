// LLM クライアント抽象（E2 / 原則 (e)）。
//
// packages/prompt の中で Claude API に触れるのは AnthropicLlmClient（anthropic-client.ts）だけで、
// 上位層（analyze-dossier / generate-message / retry）はこのインターフェースにのみ依存する。
// テスト・他パッケージからはモック実装を注入でき、実 API を叩かずに全経路を検証できる。
//
// 構造化出力は tool use で JSON スキーマを強制する（design-detail 3.1: スキーマは
// tool use / structured output で強制）。応答の tool 入力は unknown のまま返し、
// 検証（V1: zod）は呼び出し側の責務とする。

/** 1 回の LLM 呼び出し要求（ストリーミングは用いない — E11 決定） */
export interface LlmRequest {
  /** モデル ID（環境設定値 — E2） */
  model: string;
  maxTokens: number;
  /** 1 呼び出しのタイムアウト（E11） */
  timeoutMs: number;
  /** system prompt（packages/prompt が管理する固定指示のみ — 原則 (a)） */
  system: string;
  /** user メッセージ本文（サンドイッチ構造で組み立て済み — E6） */
  userText: string;
  /** 構造化出力を強制する tool 定義 */
  tool: {
    name: string;
    description: string;
    /** JSON Schema（プレーンオブジェクト） */
    inputSchema: Record<string, unknown>;
  };
}

/** LLM 応答。構造化出力の tool 入力を未検証のまま持つ */
export interface LlmResponse {
  /** tool use の入力。モデルが tool を呼ばなかった場合は undefined（V1 失敗として扱う） */
  toolInput: unknown;
  /** 応答を生成したモデル ID（結果の modelId 記録用） */
  modelId: string;
}

/** LLM クライアント抽象。失敗時は LlmTransportError を投げる契約 */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
