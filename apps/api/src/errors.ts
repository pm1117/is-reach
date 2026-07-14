// エラー標準形（design-detail 2.5 — 決定 E5）への正規化。
// すべてのエラーレスポンスは shared の apiErrorSchema の形（error.code / message /
// details? / requestId）で返す。未分類エラーの詳細はログのみに出し、レスポンスへ漏らさない。
import type { ApiError, ErrorCode } from "@is-reach/shared";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import type { AppEnv, Logger } from "./types.js";

/** エラーコード → HTTP ステータスの対応（design-detail 2.5 の表 — 唯一の対応表） */
export const ERROR_CODE_STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  AUTH_UNAUTHENTICATED: 401,
  AUTH_FORBIDDEN: 403,
  VALIDATION_FAILED: 400,
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_CONFLICT: 409,
  JOB_ALREADY_RUNNING: 409,
  RATE_LIMITED: 429,
  LLM_UNAVAILABLE: 503,
  LLM_OUTPUT_INVALID: 502,
  CRAWL_ALL_FAILED: 502,
  INTERNAL: 500,
};

/**
 * ハンドラ・ミドルウェアから throw する業務エラー。
 * message はレスポンスに載る（利用者向け・日本語）。内部事情は message に書かないこと。
 */
export class ApiHttpError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiHttpError";
    this.code = code;
    this.details = details;
  }

  get status(): ContentfulStatusCode {
    return ERROR_CODE_STATUS[this.code];
  }
}

/** zod 検証失敗 → VALIDATION_FAILED(400)。details に失敗フィールドの一覧を載せる */
export function validationError(error: ZodError): ApiHttpError {
  return new ApiHttpError("VALIDATION_FAILED", "リクエスト内容の検証に失敗しました", {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
}

function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ApiError {
  return {
    error:
      details === undefined ? { code, message, requestId } : { code, message, details, requestId },
  };
}

function requestIdOf(c: Context<AppEnv>): string {
  // request-id ミドルウェアより前段で例外が起きた場合のフォールバック
  return c.get("requestId") ?? "unknown";
}

/** グローバルエラーハンドラ（app.onError に設定する） */
export function createErrorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    const requestId = requestIdOf(c);

    if (error instanceof ApiHttpError) {
      return c.json(errorBody(error.code, error.message, requestId, error.details), error.status);
    }

    if (error instanceof ZodError) {
      // ハンドラ側で validationError() に包み損ねた場合の保険
      const apiError = validationError(error);
      return c.json(
        errorBody(apiError.code, apiError.message, requestId, apiError.details),
        apiError.status,
      );
    }

    // 未分類 → INTERNAL(500)。詳細（メッセージ・スタック）はログのみ（2.5）
    logger.error("未分類の内部エラー", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      error:
        error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    });
    return c.json(
      errorBody("INTERNAL", "内部エラーが発生しました", requestId),
      ERROR_CODE_STATUS.INTERNAL,
    );
  };
}

/** ルート未定義 → RESOURCE_NOT_FOUND(404)（app.notFound に設定する） */
export const notFoundHandler: NotFoundHandler<AppEnv> = (c) => {
  return c.json(
    errorBody("RESOURCE_NOT_FOUND", "リソースが見つかりません", requestIdOf(c)),
    ERROR_CODE_STATUS.RESOURCE_NOT_FOUND,
  );
};
