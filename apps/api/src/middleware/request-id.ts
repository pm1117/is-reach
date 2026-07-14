// リクエスト ID ミドルウェア（design-detail 2.5 / 7.2 — ApiError.requestId・監査ログ
// request_id との相関用）。
// 外部から届く x-request-id ヘッダは採用しない: 信頼境界外の入力でログ相関を汚染
// （他リクエストへのなりすまし・ログインジェクション）できてしまうため、常にサーバー側で生成する。
import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";

export const REQUEST_ID_HEADER = "x-request-id";

export function requestIdMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = randomUUID();
    c.set("requestId", id);
    c.header(REQUEST_ID_HEADER, id);
    await next();
  };
}
