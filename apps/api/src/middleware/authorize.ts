// 認可ミドルウェア（design-detail 2.4 — 決定 E3）。
// ルート単位の必要ロールは auth/route-policies.ts の宣言テーブルが唯一の情報源。
// ルート登録は registerRoute 経由に限定し、表にないルートは登録時に例外（fail-closed）。
import type { Handler, Hono, MiddlewareHandler } from "hono";
import { ApiHttpError } from "../errors.js";
import type { AppEnv } from "../types.js";
import { requireRoutePolicy, type RouteMethod, type RoutePolicy } from "../auth/route-policies.js";

/** ロール不足 = AUTH_FORBIDDEN(403)。他テナントリソースの 404 正規化（2.5）は各リソースアクセス側で行う */
export function authorize(policy: RoutePolicy): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (auth === undefined) {
      // authenticate ミドルウェア未適用のルート構成ミスに対する防御（fail-closed）
      throw new ApiHttpError("AUTH_UNAUTHENTICATED", "認証情報がありません");
    }
    if (!policy.roles.includes(auth.role)) {
      throw new ApiHttpError("AUTH_FORBIDDEN", "この操作を行う権限がありません");
    }
    await next();
  };
}

/**
 * 認可宣言テーブルを参照してルートを登録する（全エンドポイントはこの関数経由で登録する規約）。
 * ROUTE_POLICIES に宣言のないルートはここで例外になり、認可漏れのエンドポイントを作れない。
 */
export function registerRoute(
  router: Hono<AppEnv>,
  method: RouteMethod,
  path: string,
  handler: Handler<AppEnv>,
): void {
  const policy = requireRoutePolicy(method, path);
  router.on(method, path, authorize(policy), handler);
}
