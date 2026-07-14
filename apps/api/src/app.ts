// Hono アプリの組み立て（basic-design 2.1 / D1。ベースパス /api/v1 — design-detail 2.1）。
// 依存（JWT 検証器・TenantDb・キュー・AuthAdmin・ロガー）はすべて注入可能にし、
// テストではモックを渡す。ルート登録は registerRoute 経由のみ
// （認可マトリクス fail-closed — middleware/authorize.ts）。
import { Hono } from "hono";
import { ApiHttpError, createErrorHandler, notFoundHandler } from "./errors.js";
import { authenticate } from "./middleware/auth.js";
import { registerRoute } from "./middleware/authorize.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { registerAuditLogRoutes } from "./routes/audit-logs.js";
import { registerAuthHookRoutes } from "./routes/auth-hooks.js";
import { registerDeepDiveJobRoutes } from "./routes/deep-dive-jobs.js";
import { registerDeletionRequestRoutes } from "./routes/deletion-requests.js";
import { registerDossierRoutes } from "./routes/dossiers.js";
import { registerListRoutes } from "./routes/lists.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerScreeningRoutes } from "./routes/screening.js";
import { registerTemplateRoutes } from "./routes/templates.js";
import { registerTenantRoutes } from "./routes/tenant.js";
import { registerUserRoutes } from "./routes/users.js";
import { getMe } from "./routes/me.js";
import { consoleLogger, type AppEnv, type Logger } from "./types.js";
import type { RouteDeps } from "./routes/deps.js";
import type { AuthAdmin } from "./auth/auth-admin.js";
import type { JobQueue } from "@is-reach/shared";
import type { TenantDb } from "./db/tenant-db.js";
import type { TokenVerifier } from "./auth/token-verifier.js";

export interface AppDependencies {
  verifier: TokenVerifier;
  tenantDb: TenantDb;
  queue: JobQueue;
  authAdmin: AuthAdmin;
  logger?: Logger;
  /** ログイン webhook の共有シークレット（null = 無効 — routes/auth-hooks.ts） */
  authHookSecret?: string | null;
  /** テスト注入用の現在時刻 */
  now?: () => Date;
}

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const logger = deps.logger ?? consoleLogger;
  const routeDeps: RouteDeps = {
    tenantDb: deps.tenantDb,
    queue: deps.queue,
    authAdmin: deps.authAdmin,
    logger,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  };

  const app = new Hono<AppEnv>();
  app.use("*", requestIdMiddleware());
  app.onError(createErrorHandler(logger));
  app.notFound(notFoundHandler);

  // 内部 webhook（/api/v1 の外 — 共有シークレット保護。未設定なら未登録 = 404）
  registerAuthHookRoutes(app, routeDeps, deps.authHookSecret ?? null);

  // /api/v1 配下はすべて認証必須（design-detail 2.1）
  const v1 = new Hono<AppEnv>();
  v1.use("*", authenticate(deps.verifier));

  registerRoute(v1, "GET", "/me", async (c) => {
    const me = await getMe(deps.tenantDb, c.get("auth"));
    if (me === null) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "ユーザーが見つかりません");
    }
    return c.json(me);
  });

  registerScreeningRoutes(v1, routeDeps);
  registerListRoutes(v1, routeDeps);
  registerDeepDiveJobRoutes(v1, routeDeps);
  registerDossierRoutes(v1, routeDeps);
  registerMessageRoutes(v1, routeDeps);
  registerTemplateRoutes(v1, routeDeps);
  registerUserRoutes(v1, routeDeps);
  registerTenantRoutes(v1, routeDeps);
  registerAuditLogRoutes(v1, routeDeps);
  registerDeletionRequestRoutes(v1, routeDeps);

  app.route("/api/v1", v1);
  return app;
}
