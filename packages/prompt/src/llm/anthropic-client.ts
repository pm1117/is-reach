// Claude API 呼び出しの唯一の実装点（原則 (e) — basic-design 6.2）。
//
// - リトライは retry.ts（design-detail 4.3 の方針）で一元管理するため SDK の自動リトライは無効化する
// - ストリーミングは用いない（E11 決定 — 構造化出力の完全性優先）
// - SDK の型付き例外を LlmTransportError（kind 分類）へ正規化する。
//   エラーメッセージに外部データ本文・プロンプト全文を含めない（errors.ts のセキュリティ注意）
import Anthropic from "@anthropic-ai/sdk";
import { LlmTransportError } from "../errors.js";
import type { LlmClient, LlmRequest, LlmResponse } from "./client.js";

export interface AnthropicLlmClientOptions {
  /** 未指定なら SDK が環境（ANTHROPIC_API_KEY 等）から解決する */
  apiKey?: string;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly sdk: Anthropic;

  constructor(options: AnthropicLlmClientOptions = {}) {
    this.sdk = new Anthropic({
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      // リトライ方針は E11 に従い retry.ts が持つ。SDK 側の自動リトライは二重化するため切る
      maxRetries: 0,
    });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    let response: Anthropic.Message;
    try {
      response = await this.sdk.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.userText }],
          tools: [
            {
              name: request.tool.name,
              description: request.tool.description,
              input_schema: request.tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
            },
          ],
          // 構造化出力を強制する（design-detail 3.1）
          tool_choice: { type: "tool", name: request.tool.name },
        },
        { timeout: request.timeoutMs },
      );
    } catch (error) {
      throw toTransportError(error);
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    return {
      // tool を呼ばなかった応答は toolInput: undefined → V1 失敗として上位が処理する
      toolInput: toolUse?.input,
      modelId: response.model,
    };
  }
}

/** SDK の例外を design-detail 4.3 の分類（LlmFailureKind）へ写像する */
function toTransportError(error: unknown): LlmTransportError {
  // APIConnectionTimeoutError は APIConnectionError の派生のため先に判定する
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmTransportError("timeout", "LLM 呼び出しがタイムアウトした", undefined);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmTransportError("connection_error", "LLM への接続に失敗した", undefined);
  }
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === "number" ? error.status : undefined;
    if (status === 429) {
      return new LlmTransportError("rate_limited", "LLM がレート制限を返した (429)", status);
    }
    if (status === 529) {
      return new LlmTransportError("overloaded", "LLM が過負荷を返した (529)", status);
    }
    if (status !== undefined && status >= 500) {
      return new LlmTransportError(
        "server_error",
        `LLM がサーバーエラーを返した (${status})`,
        status,
      );
    }
    if (status === 400) {
      // 設計バグ扱い（E11）。SDK の error.message はプロンプト断片を含みうる（外部データを
      // ログへ残さない保証を自己完結させるため）ので伝播せず、種別・ステータスのみ残す
      return new LlmTransportError(
        "invalid_request",
        `LLM がリクエスト不正を返した (400: ${error.name})`,
        status,
      );
    }
    return new LlmTransportError(
      "invalid_request",
      `LLM が想定外のステータスを返した (${status ?? "不明"})`,
      status,
    );
  }
  return new LlmTransportError(
    "connection_error",
    "LLM 呼び出しで不明なエラーが発生した",
    undefined,
  );
}
