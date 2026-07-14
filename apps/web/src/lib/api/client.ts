// apps/api を呼ぶ薄い HTTP クライアント。
// - 型契約は @is-reach/shared の zod スキーマのみを使う（依存方向: apps/web → shared のみ）
// - エラーレスポンスは標準形（design-detail 2.5 = apiErrorSchema）としてパースし、
//   requestId を画面表示用に取り出せる形（ApiClientError）で保持する（ui-spec 4.3）
import { apiErrorSchema, type ErrorCode } from "@is-reach/shared";
import type { z } from "zod";

/** サーバーの標準エラーコードに、クライアント側で発生する分類を加えたもの */
export type ApiClientErrorCode = ErrorCode | "NETWORK_ERROR" | "INVALID_RESPONSE";

interface ApiClientErrorInit {
  code: ApiClientErrorCode;
  message: string;
  status: number | null;
  requestId: string | null;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class ApiClientError extends Error {
  readonly code: ApiClientErrorCode;
  /** HTTP ステータス（レスポンス到達前の失敗は null） */
  readonly status: number | null;
  /** ログ相関用 ID。エラー表示時に「参照 ID」として出す（ui-spec 4.3） */
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: ApiClientErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiClientError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

export interface ApiClientOptions {
  /** 例: `http://localhost:3001/api/v1`（末尾スラッシュ有無は吸収する） */
  baseUrl: string;
  /** Supabase Auth セッションの JWT を返す。未認証時は null */
  getAccessToken: () => Promise<string | null>;
  /** テスト差し替え用（既定: グローバル fetch） */
  fetchFn?: typeof fetch;
}

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export class ApiClient {
  readonly #options: ApiClientOptions;

  constructor(options: ApiClientOptions) {
    this.#options = options;
  }

  /** レスポンスボディを schema で検証して返す */
  async request<T>(path: string, schema: z.ZodType<T>, init: ApiRequestInit = {}): Promise<T> {
    const response = await this.#send(path, init);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new ApiClientError({
        code: "INVALID_RESPONSE",
        message: "サーバー応答を解釈できませんでした",
        status: response.status,
        requestId: null,
        cause,
      });
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiClientError({
        code: "INVALID_RESPONSE",
        message: "サーバー応答が想定した形式ではありません",
        status: response.status,
        requestId: null,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  /** 204 No Content 等、ボディを使わないエンドポイント用 */
  async requestVoid(path: string, init: ApiRequestInit = {}): Promise<void> {
    await this.#send(path, init);
  }

  async #send(path: string, init: ApiRequestInit): Promise<Response> {
    const token = await this.#options.getAccessToken();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token !== null) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const fetchFn = this.#options.fetchFn ?? fetch;
    let response: Response;
    try {
      response = await fetchFn(joinUrl(this.#options.baseUrl, path), {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal ?? null,
      });
    } catch (cause) {
      throw new ApiClientError({
        code: "NETWORK_ERROR",
        message: "サーバーに接続できませんでした。ネットワークを確認して再試行してください",
        status: null,
        requestId: null,
        cause,
      });
    }

    if (!response.ok) {
      throw await toApiClientError(response);
    }
    return response;
  }
}

/** エラーレスポンスを標準形（design-detail 2.5）としてパースする */
async function toApiClientError(response: Response): Promise<ApiClientError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // 標準形でないボディ（HTML エラーページ等）は下の INVALID_RESPONSE 扱いへ
  }
  const parsed = apiErrorSchema.safeParse(payload);
  if (parsed.success) {
    const { code, message, requestId, details } = parsed.data.error;
    return new ApiClientError({ code, message, status: response.status, requestId, details });
  }
  return new ApiClientError({
    code: "INVALID_RESPONSE",
    message: `サーバーからエラー応答（HTTP ${response.status}）を受け取りました`,
    status: response.status,
    requestId: null,
  });
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
