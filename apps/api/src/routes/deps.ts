// ルート共通の依存（app.ts が組み立てて各 register 関数へ渡す）とアクター解決。
import type { JobQueue } from "@is-reach/shared";
import { ApiHttpError } from "../errors.js";
import type { AuthAdmin } from "../auth/auth-admin.js";
import type { TenantDb, TenantQuerier } from "../db/tenant-db.js";
import type { AuthContext, Logger } from "../types.js";

export interface RouteDeps {
  tenantDb: TenantDb;
  queue: JobQueue;
  authAdmin: AuthAdmin;
  logger: Logger;
  /** テスト注入用の現在時刻（スクリーニングの evaluatedAt 等） */
  now?: () => Date;
}

export function nowIso(deps: RouteDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

interface ActorRow {
  id: string;
  role: string;
}

/**
 * 認証コンテキスト（JWT）から users 行のアクターを解決する。
 * 監査ログの actor_user_id・created_by 系の参照に使う（withTenantContext 内で呼ぶこと）。
 * 行がない・無効化済みは 401（JWT は有効でもテナント内で無効なユーザー）。
 */
export async function resolveActor(
  tx: TenantQuerier,
  auth: AuthContext,
): Promise<{ userId: string }> {
  const result = await tx.query<ActorRow>(
    `select id, role from users
      where auth_user_id = $1 and invitation_status = 'active'`,
    [auth.authUserId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ApiHttpError("AUTH_UNAUTHENTICATED", "ユーザーが見つからないか無効化されています");
  }
  return { userId: row.id };
}
